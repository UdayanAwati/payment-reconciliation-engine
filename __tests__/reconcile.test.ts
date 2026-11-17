import { describe, expect, it } from "vitest";
import { parseBankCsv, parsePlatformCsv } from "../lib/csv";
import { parseUnits, unitsToNumber } from "../lib/money";
import { reconcile, reconcileCsv } from "../lib/reconcile";
import type { BankRow, PlatformTx } from "../lib/types";

/** Test helpers: dollars are written as strings and converted to exact integer units. */
const units = (s: string) => parseUnits(s)!;

function plat(txId: string, date: string, amount: string, status: "CAPTURED" | "REFUND" = "CAPTURED"): PlatformTx {
  const a = units(amount);
  return {
    txId,
    timestamp: `${date}T12:00:00Z`,
    date,
    customerId: "CUST_0001",
    amountRaw: status === "REFUND" ? -Math.abs(a) : a,
    currency: "USD",
    status,
  };
}

function bank(settlementId: string, txRef: string, settledDate: string, amount: string, type: "CREDIT" | "REFUND" = "CREDIT"): BankRow {
  const a = units(amount);
  return { settlementId, txRef, settledDate, settledAmount: type === "REFUND" ? -Math.abs(a) : a, currency: "USD", type };
}

describe("1. exact match within the T+1/T+2 window", () => {
  it.each([
    ["T+1", "2026-10-11"],
    ["T+2", "2026-10-12"],
  ])("matches a clean transaction settling %s", (_label, settled) => {
    const r = reconcile([plat("TX_1", "2026-10-10", "100.0000")], [bank("STL_1", "TX_1", settled, "100.00")]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].category).toBe("MATCHED");
    expect(r.rows[0].flags).toEqual(["MATCHED"]);
    expect(r.rows[0].severity).toBe("NONE");
    expect(r.rows[0].delta).toBe(0);
    expect(r.totals.platformOctoberTotal).toBe(r.totals.bankOctoberSettledTotal);
    expect(r.totals.netUnexplained).toBe(0);
  });

  it("flags settlement outside T+1/T+2 as a lag anomaly with no amount impact", () => {
    const r = reconcile([plat("TX_1", "2026-10-10", "100.0000")], [bank("STL_1", "TX_1", "2026-10-15", "100.00")]);
    expect(r.rows[0].category).toBe("LAG_ANOMALY");
    expect(r.totals.netUnexplained).toBe(0);
  });

  it("treats a matched REFUND pair (platform REFUND + bank REFUND) as matched, not orphan", () => {
    const r = reconcile([plat("TX_R1", "2026-10-10", "25.0000", "REFUND")], [bank("STL_R1", "TX_R1", "2026-10-11", "25.00", "REFUND")]);
    expect(r.rows[0].category).toBe("MATCHED");
    expect(r.totals.platformOctoberTotal).toBe(units("-25"));
    expect(r.totals.netUnexplained).toBe(0);
  });
});

describe("2. next-month cutoff", () => {
  it("classifies an Oct 31 -> Nov 2 settlement as TIMING_DIFFERENCE, not missing funds", () => {
    const r = reconcile([plat("TX_T", "2026-10-31", "389.9900")], [bank("STL_T", "TX_T", "2026-11-02", "389.99")]);
    expect(r.rows[0].category).toBe("TIMING_DIFFERENCE");
    expect(r.rows[0].flags).not.toContain("MISSING_SETTLEMENT");
    expect(r.totals.timing).toBe(units("-389.99"));
    expect(r.totals.bankOctoberSettledTotal).toBe(0);
    expect(r.totals.bankCutoffWindowTotal).toBe(units("389.99"));
    expect(r.totals.netUnexplained).toBe(0);
  });

  it("does not treat a settlement after the Nov 1-3 window as a timing difference", () => {
    const r = reconcile([plat("TX_T", "2026-10-31", "50.0000")], [bank("STL_T", "TX_T", "2026-11-09", "50.00")]);
    expect(r.rows[0].category).toBe("MISSING_SETTLEMENT");
    expect(r.totals.netUnexplained).toBe(units("-50"));
  });

  it("reports a platform transaction with no bank row at all as missing", () => {
    const r = reconcile([plat("TX_M", "2026-10-05", "75.0000")], []);
    expect(r.rows[0].category).toBe("MISSING_SETTLEMENT");
    expect(r.rows[0].severity).toBe("HIGH");
    expect(r.totals.netUnexplained).toBe(units("-75"));
  });
});

describe("3. cumulative rounding drift", () => {
  const platformRows = Array.from({ length: 25 }, (_, i) => plat(`TX_R${i}`, "2026-10-12", "10.0040"));
  const bankRows = platformRows.map((p, i) => bank(`STL_R${i}`, p.txId, "2026-10-13", "10.00"));
  const r = reconcile(platformRows, bankRows);

  it("shows $0.00 row-by-row but -$0.10 in aggregate", () => {
    expect(r.rows).toHaveLength(25);
    expect(r.rows.every((row) => row.category === "ROUNDING_DRIFT")).toBe(true);
    expect(r.rows.every((row) => row.delta === 0)).toBe(true); // cent-level row variance is $0.00
    expect(r.rows.every((row) => row.subCentResidual === units("-0.0040"))).toBe(true);

    const ra = r.roundingAnalysis;
    expect(ra.affectedRows).toBe(25);
    expect(unitsToNumber(ra.platformRawSum)).toBe(250.1); // 25 x 10.0040, exact
    expect(unitsToNumber(ra.bankSettledSum)).toBe(250.0); // 25 x 10.00
    expect(unitsToNumber(ra.aggregateDrift)).toBe(-0.1);
    expect(ra.rowLevelDriftTotal).toBe(0);
  });

  it("books the drift in the waterfall and leaves nothing unexplained", () => {
    expect(unitsToNumber(r.totals.rounding)).toBe(-0.1);
    expect(unitsToNumber(r.totals.platformOctoberTotal)).toBe(250.1);
    expect(unitsToNumber(r.totals.bankOctoberSettledTotal)).toBe(250.0);
    expect(r.totals.netUnexplained).toBe(0);
  });

  it("rounds ROUND_HALF_UP: 10.0050 settles as 10.01, and negative ties round away from zero", () => {
    const up = reconcile([plat("TX_H", "2026-10-12", "10.0050")], [bank("STL_H", "TX_H", "2026-10-13", "10.01")]);
    expect(up.rows[0].category).toBe("ROUNDING_DRIFT");
    expect(up.rows[0].delta).toBe(0);
    expect(up.totals.netUnexplained).toBe(0);
    const neg = reconcile([plat("TX_N", "2026-10-12", "10.0050", "REFUND")], [bank("STL_N", "TX_N", "2026-10-13", "10.01", "REFUND")]);
    expect(neg.rows[0].delta).toBe(0);
    expect(neg.totals.netUnexplained).toBe(0);
  });

  it("flags a genuine one-cent error as a mismatch, not rounding", () => {
    const bad = reconcile([plat("TX_X", "2026-10-12", "10.0040")], [bank("STL_X", "TX_X", "2026-10-13", "10.01")]);
    expect(bad.rows[0].flags).toContain("AMOUNT_MISMATCH");
    expect(bad.totals.netUnexplained).toBe(units("0.01"));
  });
});

describe("4. duplicate bank settlement", () => {
  const r = reconcile(
    [plat("TX_4001", "2026-10-08", "215.7500")],
    [bank("STL_9042A", "TX_4001", "2026-10-09", "215.75"), bank("STL_9042B", "TX_4001", "2026-10-10", "215.75")],
  );

  it("is caught by tx_ref grouping even though the settlement_ids differ", () => {
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].category).toBe("DUPLICATE_SETTLEMENT");
    expect(r.rows[0].settlementIds).toEqual(["STL_9042A", "STL_9042B"]);
    expect(r.rows[0].severity).toBe("HIGH");
    expect(r.rows[0].delta).toBe(units("215.75")); // bank paid twice
  });

  it("bridges the extra credit in the waterfall", () => {
    expect(r.totals.duplicates).toBe(units("215.75"));
    expect(r.totals.netUnexplained).toBe(0);
  });

  it("does not flag the pair when the duplicate sits in the Nov window only as an October overpayment", () => {
    const edge = reconcile(
      [plat("TX_E", "2026-10-30", "40.0000")],
      [bank("STL_E1", "TX_E", "2026-10-31", "40.00"), bank("STL_E2", "TX_E", "2026-11-01", "40.00")],
    );
    expect(edge.rows[0].flags).toContain("DUPLICATE_SETTLEMENT");
    expect(edge.totals.duplicates).toBe(0); // second credit is not in October's bank total
    expect(edge.totals.netUnexplained).toBe(0);
  });
});

describe("5. orphan refund", () => {
  const r = reconcile(
    [plat("TX_1", "2026-10-10", "100.0000")],
    [bank("STL_1", "TX_1", "2026-10-11", "100.00"), bank("STL_8801", "TX_9998", "2026-10-14", "42.50", "REFUND")],
  );

  it("is flagged with high severity when tx_ref is not in the platform ledger", () => {
    const orphan = r.rows.find((row) => row.txRef === "TX_9998")!;
    expect(orphan.category).toBe("ORPHAN_REFUND");
    expect(orphan.severity).toBe("HIGH");
    expect(orphan.txId).toBeNull();
    expect(orphan.platformAmount).toBeNull();
    expect(orphan.bankAmount).toBe(units("-42.50"));
    expect(orphan.recommendedAction.length).toBeGreaterThan(0);
  });

  it("sorts high-severity exceptions first and keeps the waterfall closed", () => {
    expect(r.rows[0].category).toBe("ORPHAN_REFUND");
    expect(r.totals.orphans).toBe(units("-42.50"));
    expect(r.totals.netUnexplained).toBe(0);
  });

  it("treats a bank credit with no platform record as unexplained, not as an orphan refund", () => {
    const c = reconcile([], [bank("STL_C", "TX_NOPE", "2026-10-11", "10.00")]);
    expect(c.rows[0].category).toBe("UNMATCHED_CREDIT");
    expect(c.totals.netUnexplained).toBe(units("10"));
  });
});

describe("6. malformed or missing CSV input", () => {
  const goodPlatform = "tx_id,timestamp,customer_id,amount_raw,currency,status\nTX_1,2026-10-10T10:00:00Z,C1,100.0000,USD,CAPTURED\n";
  const goodBank = "settlement_id,tx_ref,settled_date,settled_amount,currency,type\nSTL_1,TX_1,2026-10-11,100.00,USD,CREDIT\n";

  it("does not throw on empty input", () => {
    expect(() => reconcileCsv("", "")).not.toThrow();
    const { result, issues } = reconcileCsv("", "");
    expect(result.rows).toHaveLength(0);
    expect(issues.filter((i) => i.level === "error")).toHaveLength(2);
  });

  it("reports missing required columns instead of crashing", () => {
    const p = parsePlatformCsv("tx_id,timestamp\nTX_1,2026-10-10T10:00:00Z\n");
    expect(p.rows).toHaveLength(0);
    expect(p.issues[0].level).toBe("error");
    expect(p.issues[0].message).toMatch(/amount_raw/);
    expect(p.issues[0].message).toMatch(/status/);

    const b = parseBankCsv("settlement_id,tx_ref\nSTL_1,TX_1\n");
    expect(b.rows).toHaveLength(0);
    expect(b.issues[0].message).toMatch(/settled_date/);

    expect(() => reconcileCsv("tx_id\nTX_1\n", "nonsense")).not.toThrow();
  });

  it("skips bad rows, keeps good ones, and reports each problem", () => {
    const messy =
      "tx_id,timestamp,customer_id,amount_raw,currency,status\n" +
      "TX_1,2026-10-10T10:00:00Z,C1,100.0000,USD,CAPTURED\n" +
      ",2026-10-10T10:00:00Z,C1,5.0000,USD,CAPTURED\n" + // empty id
      "TX_3,not-a-date,C1,5.0000,USD,CAPTURED\n" + // bad date
      "TX_4,2026-10-10T10:00:00Z,C1,abc,USD,CAPTURED\n" + // bad amount
      "TX_5,2026-10-10T10:00:00Z,C1,5.0000,USD,CHARGEBACK\n" + // bad status
      "TX_6,2026-10-10T10:00:00Z,C1,5.0000,EUR,CAPTURED\n" + // wrong currency
      "TX_1,2026-10-10T10:00:00Z,C1,100.0000,USD,CAPTURED\n" + // repeated id
      "TX_7,2026-10-10T10:00:00Z\n"; // short row
    const p = parsePlatformCsv(messy);
    expect(p.rows.map((r) => r.txId)).toEqual(["TX_1"]);
    expect(p.issues.length).toBe(7);
    expect(() => reconcile(p.rows, [])).not.toThrow();
  });

  it("handles a BOM, CRLF line endings, shuffled/uppercase headers, quoted fields and a missing optional column", () => {
    const platformCsv = "﻿TX_ID,Timestamp,AMOUNT_RAW,Status\r\n\"TX_1\",2026-10-10T10:00:00Z,\"100.0000\",captured\r\n";
    const { result, issues } = reconcileCsv(platformCsv, goodBank);
    expect(result.rows[0].category).toBe("MATCHED");
    expect(issues.every((i) => i.level === "warning")).toBe(true); // only the optional-column notices
  });

  it("works end to end on well-formed CSV text", () => {
    const { result, issues } = reconcileCsv(goodPlatform, goodBank);
    expect(issues).toHaveLength(0);
    expect(result.rows[0].category).toBe("MATCHED");
    expect(result.totals.netUnexplained).toBe(0);
  });
});
