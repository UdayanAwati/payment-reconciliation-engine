import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateDataset } from "../lib/generator";
import { parseBankCsv, parsePlatformCsv } from "../lib/csv";
import { formatUsd, parseUnits, roundHalfUpToCents, unitsToDecimalString } from "../lib/money";
import { reconcile } from "../lib/reconcile";
import { buildReportCsv } from "../lib/report";
import type { GroundTruth } from "../lib/types";
import { checkRecall } from "../lib/verify";

describe("money", () => {
  it("parses and formats exactly", () => {
    expect(parseUnits("10.0040")).toBe(100040);
    expect(parseUnits("-42.5")).toBe(-425000);
    expect(parseUnits("$1,234.50")).toBe(12345000);
    expect(parseUnits("abc")).toBeNull();
    expect(parseUnits("")).toBeNull();
    expect(unitsToDecimalString(100040, 4)).toBe("10.0040");
    expect(unitsToDecimalString(-425000, 2)).toBe("-42.50");
    expect(formatUsd(-40, { dp: 2 })).toBe("$0.00");
    expect(formatUsd(-1000, { dp: 2 })).toBe("-$0.10"); // sub-cent shows as zero, never "-$0.00"
  });
  it("rounds half up, away from zero for negatives", () => {
    expect(roundHalfUpToCents(100040)).toBe(100000);
    expect(roundHalfUpToCents(100050)).toBe(100100);
    expect(roundHalfUpToCents(-100050)).toBe(-100100);
  });
});

describe("synthetic data generator", () => {
  const ds = generateDataset();

  it("is deterministic", () => {
    const again = generateDataset();
    expect(again.platformCsv).toBe(ds.platformCsv);
    expect(again.bankCsv).toBe(ds.bankCsv);
    expect(again.groundTruthJson).toBe(ds.groundTruthJson);
  });

  it("produces ~100 platform rows with 4dp amounts and 2dp bank amounts", () => {
    expect(ds.platform).toHaveLength(100);
    const lines = ds.platformCsv.trim().split("\n").slice(1);
    expect(lines.every((l) => /,-?\d+\.\d{4},USD,(CAPTURED|REFUND)$/.test(l))).toBe(true);
    const bankLines = ds.bankCsv.trim().split("\n").slice(1);
    expect(bankLines.every((l) => /,-?\d+\.\d{2},USD,(CREDIT|REFUND)$/.test(l))).toBe(true);
  });

  it("the shipped public/data files match the default generator output", () => {
    const read = (f: string) => readFileSync(join(__dirname, "..", "public", "data", f), "utf8");
    expect(read("platform_transactions.csv")).toBe(ds.platformCsv);
    expect(read("bank_settlements.csv")).toBe(ds.bankCsv);
    expect(read("ground_truth.json")).toBe(ds.groundTruthJson);
  });

  it("plants the four scenarios exactly as specified", () => {
    const gt = ds.groundTruth.anomalies;
    expect(gt.TIMING_DIFFERENCE.tx_ids).toHaveLength(3);
    const timing = ds.bank.filter((b) => gt.TIMING_DIFFERENCE.tx_ids.includes(b.txRef)).map((b) => b.settledDate).sort();
    expect(timing).toEqual(["2026-11-01", "2026-11-01", "2026-11-02"]);
    const captured = ds.platform.filter((p) => gt.TIMING_DIFFERENCE.tx_ids.includes(p.txId)).map((p) => p.date).sort();
    expect(captured).toEqual(["2026-10-30", "2026-10-31", "2026-10-31"]);

    expect(gt.ROUNDING_DRIFT.tx_ids).toHaveLength(25);
    expect(gt.ROUNDING_DRIFT.platform_total).toBe(250.1);
    expect(gt.ROUNDING_DRIFT.bank_total).toBe(250);
    expect(gt.ROUNDING_DRIFT.expected_aggregate_drift).toBe(-0.1);

    expect(gt.DUPLICATE_SETTLEMENT.tx_ids).toHaveLength(2);
    for (const id of gt.DUPLICATE_SETTLEMENT.tx_ids) {
      const rows = ds.bank.filter((b) => b.txRef === id);
      expect(rows).toHaveLength(2);
      expect(rows[0].settledAmount).toBe(rows[1].settledAmount);
      expect(rows[0].settlementId).not.toBe(rows[1].settlementId);
    }
    expect(gt.DUPLICATE_SETTLEMENT.settlement_ids).toContain("STL_9042A");
    expect(gt.DUPLICATE_SETTLEMENT.settlement_ids).toContain("STL_9042B");

    expect(gt.ORPHAN_REFUND.tx_refs).toEqual(["TX_9998", "TX_9999"]);
    for (const ref of gt.ORPHAN_REFUND.tx_refs) {
      expect(ds.platform.some((p) => p.txId === ref)).toBe(false);
      const row = ds.bank.find((b) => b.txRef === ref)!;
      expect(row.type).toBe("REFUND");
      expect(row.settledAmount).toBeLessThan(0);
    }
  });

  it("survives a CSV round trip", () => {
    expect(parsePlatformCsv(ds.platformCsv).issues).toHaveLength(0);
    expect(parseBankCsv(ds.bankCsv).issues).toHaveLength(0);
    expect(parsePlatformCsv(ds.platformCsv).rows).toEqual(ds.platform);
    expect(parseBankCsv(ds.bankCsv).rows).toEqual(ds.bank);
  });
});

describe.each([2026, 1, 424242])("full pipeline on generated data (seed %i)", (seed) => {
  const ds = generateDataset(seed);
  const result = reconcile(parsePlatformCsv(ds.platformCsv).rows, parseBankCsv(ds.bankCsv).rows);
  const truth: GroundTruth = JSON.parse(ds.groundTruthJson);

  it("achieves 100% recall with no false positives on the planted anomalies", () => {
    for (const r of checkRecall(result, truth)) {
      expect(r.missed, `${r.category} missed`).toEqual([]);
      expect(r.extra, `${r.category} extra`).toEqual([]);
      expect(r.found.length).toBe(r.expected.length);
    }
  });

  it("matches every non-anomalous transaction", () => {
    expect(result.counts.MATCHED).toBe(70);
    expect(result.counts.TIMING_DIFFERENCE).toBe(3);
    expect(result.counts.ROUNDING_DRIFT).toBe(25);
    expect(result.counts.DUPLICATE_SETTLEMENT).toBe(2);
    expect(result.counts.ORPHAN_REFUND).toBe(2);
    expect(result.counts.MISSING_SETTLEMENT + result.counts.AMOUNT_MISMATCH + result.counts.UNMATCHED_CREDIT + result.counts.LAG_ANOMALY).toBe(0);
  });

  it("resolves the variance waterfall to exactly $0.00 and matches ground-truth amounts", () => {
    const t = result.totals;
    expect(t.netUnexplained).toBe(0);
    expect(t.reconciles).toBe(true);
    expect(t.platformOctoberTotal + t.timing + t.rounding + t.duplicates + t.orphans).toBe(t.bankOctoberSettledTotal);
    expect(t.timing / 10000).toBeCloseTo(-truth.anomalies.TIMING_DIFFERENCE.expected_timing_total, 8);
    expect(t.rounding / 10000).toBeCloseTo(truth.anomalies.ROUNDING_DRIFT.expected_aggregate_drift, 8);
    expect(t.duplicates / 10000).toBeCloseTo(truth.anomalies.DUPLICATE_SETTLEMENT.expected_duplicate_total, 8);
    expect(t.orphans / 10000).toBeCloseTo(truth.anomalies.ORPHAN_REFUND.expected_orphan_total, 8);
  });

  it("exports a report with one line per row", () => {
    const csv = buildReportCsv(result.rows);
    expect(csv.trim().split("\n").length).toBeGreaterThanOrEqual(result.rows.length + 1);
    expect(csv.startsWith("tx_id,settlement_id,platform_amount,bank_amount,delta,")).toBe(true);
  });
});
