import { addDays } from "./dates";
import { roundHalfUpToCents, unitsToDecimalString, UNITS_PER_CENT } from "./money";
import type { BankRow, GroundTruth, PlatformTx } from "./types";

export const DEFAULT_SEED = 2026;

export const PERIOD = {
  start: "2026-10-01",
  end: "2026-10-31",
  cutoffStart: "2026-11-01",
  cutoffEnd: "2026-11-03",
} as const;

/** mulberry32: tiny, fast, deterministic PRNG. */
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function ts(date: string, h: number, m: number, s: number): string {
  return `${date}T${pad(h)}:${pad(m)}:${pad(s)}Z`;
}

export interface GeneratedDataset {
  platform: PlatformTx[];
  bank: BankRow[];
  platformCsv: string;
  bankCsv: string;
  groundTruth: GroundTruth;
  groundTruthJson: string;
}

/** Amount strings -> units, kept local so the generator has no parsing dependency. */
const u = (dollars4dp: string): number => {
  const neg = dollars4dp.startsWith("-");
  const [w, f = ""] = dollars4dp.replace("-", "").split(".");
  const units = Number(w) * 10_000 + Number((f + "0000").slice(0, 4));
  return neg ? -units : units;
};

/**
 * Generate the October 2026 dataset (+ early-November cutoff buffer).
 *
 * Row budget (100 platform rows):
 *   70 normal (64 CAPTURED + 6 REFUND)  + 3 timing + 25 rounding + 2 duplicate = 100
 * Bank-only orphan refunds add 2 rows that have no platform counterpart.
 *
 * The random part only varies the "normal" rows; the planted anomalies and their IDs
 * are fixed so ground_truth.json is identical for every seed.
 */
export function generateDataset(seed: number = DEFAULT_SEED): GeneratedDataset {
  const rnd = makeRng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

  const platform: PlatformTx[] = [];
  const bankDraft: Omit<BankRow, "settlementId">[] = [];
  const fixedBank: BankRow[] = []; // anomaly rows with hand-assigned settlement ids

  const addPlatform = (txId: string, date: string, h: number, m: number, s: number, cust: string, amountUnits: number) => {
    platform.push({
      txId,
      timestamp: ts(date, h, m, s),
      date,
      customerId: cust,
      amountRaw: amountUnits,
      currency: "USD",
      status: amountUnits < 0 ? "REFUND" : "CAPTURED",
    });
  };

  // ---- Normal rows: 64 CAPTURED + 6 REFUND, captured Oct 1-29 so T+1/T+2 stays in October.
  const normalCount = 70;
  const refundSlots = new Set<number>();
  while (refundSlots.size < 6) refundSlots.add(int(8, normalCount - 1));
  for (let i = 0; i < normalCount; i++) {
    const txId = `TX_${1001 + i}`;
    const date = `2026-10-${pad(int(1, 29))}`;
    const cust = `CUST_${pad(int(1, 40), 4)}`;
    const isRefund = refundSlots.has(i);
    // Whole-cent amounts carried at 4dp (e.g. 123.4500): clean rows have no sub-cent residual,
    // so the only rounding drift in the dataset is the planted scenario.
    const cents = isRefund ? int(500, 15_000) : int(1_200, 95_000);
    const units = (isRefund ? -cents : cents) * UNITS_PER_CENT;
    addPlatform(txId, date, int(0, 23), int(0, 59), int(0, 59), cust, units);
    bankDraft.push({
      txRef: txId,
      settledDate: addDays(date, int(1, 2)),
      settledAmount: roundHalfUpToCents(units),
      currency: "USD",
      type: isRefund ? "REFUND" : "CREDIT",
    });
  }

  // ---- Anomaly 1: next-month cutoff (TIMING_DIFFERENCE) - captured Oct 30/31, settle Nov 1/2.
  const timing: { txId: string; date: string; time: [number, number, number]; amount: string; settle: string; stl: string }[] = [
    { txId: "TX_2001", date: "2026-10-30", time: [22, 15, 41], amount: "1249.5000", settle: "2026-11-01", stl: "STL_7001" },
    { txId: "TX_2002", date: "2026-10-31", time: [9, 2, 17], amount: "389.9900", settle: "2026-11-01", stl: "STL_7002" },
    { txId: "TX_2003", date: "2026-10-31", time: [23, 48, 55], amount: "76.2500", settle: "2026-11-02", stl: "STL_7003" },
  ];
  let timingTotal = 0;
  timing.forEach((t, i) => {
    const units = u(t.amount);
    timingTotal += roundHalfUpToCents(units);
    addPlatform(t.txId, t.date, ...t.time, `CUST_${pad(41 + i, 4)}`, units);
    fixedBank.push({
      settlementId: t.stl,
      txRef: t.txId,
      settledDate: t.settle,
      settledAmount: roundHalfUpToCents(units),
      currency: "USD",
      type: "CREDIT",
    });
  });

  // ---- Anomaly 2: cumulative rounding drift - 25 x 10.0040 settle as 10.00.
  const roundingIds: string[] = [];
  for (let i = 0; i < 25; i++) {
    const txId = `TX_${3001 + i}`;
    roundingIds.push(txId);
    const date = `2026-10-${pad(12 + (i % 5))}`;
    const units = u("10.0040");
    addPlatform(txId, date, 8 + (i % 10), (i * 7) % 60, (i * 13) % 60, `CUST_${pad(50 + (i % 5), 4)}`, units);
    bankDraft.push({
      txRef: txId,
      settledDate: addDays(date, 1 + (i % 2)),
      settledAmount: roundHalfUpToCents(units), // 10.0040 -> 10.00 (ROUND_HALF_UP)
      currency: "USD",
      type: "CREDIT",
    });
  }

  // ---- Anomaly 3: duplicate bank entries - same tx_ref + amount, different settlement_id.
  const dups = [
    { txId: "TX_4001", date: "2026-10-08", amount: "215.7500", a: "STL_9042A", b: "STL_9042B", cust: "CUST_0061" },
    { txId: "TX_4002", date: "2026-10-21", amount: "88.4000", a: "STL_9077A", b: "STL_9077B", cust: "CUST_0062" },
  ];
  let duplicateTotal = 0;
  dups.forEach((d, i) => {
    const units = u(d.amount);
    addPlatform(d.txId, d.date, 11 + i, 20 + i, 30 + i, d.cust, units);
    const cents = roundHalfUpToCents(units);
    duplicateTotal += cents;
    fixedBank.push(
      { settlementId: d.a, txRef: d.txId, settledDate: addDays(d.date, 1), settledAmount: cents, currency: "USD", type: "CREDIT" },
      { settlementId: d.b, txRef: d.txId, settledDate: addDays(d.date, 2), settledAmount: cents, currency: "USD", type: "CREDIT" },
    );
  });

  // ---- Anomaly 4: orphan refunds - bank-only REFUND rows whose tx_ref is not on the platform.
  const orphans = [
    { stl: "STL_8801", ref: "TX_9998", date: "2026-10-14", amount: "-42.50" },
    { stl: "STL_8802", ref: "TX_9999", date: "2026-10-27", amount: "-129.99" },
  ];
  let orphanTotal = 0;
  for (const o of orphans) {
    const cents = u(o.amount);
    orphanTotal += cents;
    fixedBank.push({ settlementId: o.stl, txRef: o.ref, settledDate: o.date, settledAmount: cents, currency: "USD", type: "REFUND" });
  }

  // ---- Assign sequential settlement ids to normal/rounding rows (after a stable sort).
  bankDraft.sort((x, y) => (x.settledDate === y.settledDate ? x.txRef.localeCompare(y.txRef) : x.settledDate < y.settledDate ? -1 : 1));
  const generatedBank: BankRow[] = bankDraft.map((b, i) => ({ settlementId: `STL_${1001 + i}`, ...b }));

  const bank = [...generatedBank, ...fixedBank].sort((x, y) =>
    x.settledDate === y.settledDate ? x.settlementId.localeCompare(y.settlementId) : x.settledDate < y.settledDate ? -1 : 1,
  );
  platform.sort((x, y) => (x.timestamp === y.timestamp ? x.txId.localeCompare(y.txId) : x.timestamp < y.timestamp ? -1 : 1));

  const roundingRaw = u("10.0040") * 25;
  const roundingBank = roundHalfUpToCents(u("10.0040")) * 25;
  const toNum = (units: number) => Number(unitsToDecimalString(units, 4));

  const groundTruth: GroundTruth = {
    seed,
    period: { ...PERIOD },
    anomalies: {
      TIMING_DIFFERENCE: {
        tx_ids: timing.map((t) => t.txId),
        settlement_ids: timing.map((t) => t.stl),
        expected_timing_total: toNum(timingTotal),
      },
      ROUNDING_DRIFT: {
        tx_ids: roundingIds,
        settlement_ids: generatedBank.filter((b) => roundingIds.includes(b.txRef)).map((b) => b.settlementId),
        platform_total: toNum(roundingRaw),
        bank_total: toNum(roundingBank),
        expected_aggregate_drift: toNum(roundingBank - roundingRaw),
        expected_row_level_drift: 0,
      },
      DUPLICATE_SETTLEMENT: {
        tx_ids: dups.map((d) => d.txId),
        settlement_ids: dups.flatMap((d) => [d.a, d.b]),
        duplicate_settlement_ids: dups.map((d) => d.b),
        expected_duplicate_total: toNum(duplicateTotal),
      },
      ORPHAN_REFUND: {
        tx_refs: orphans.map((o) => o.ref),
        settlement_ids: orphans.map((o) => o.stl),
        expected_orphan_total: toNum(orphanTotal),
      },
    },
  };

  return {
    platform,
    bank,
    platformCsv: toPlatformCsv(platform),
    bankCsv: toBankCsv(bank),
    groundTruth,
    groundTruthJson: JSON.stringify(groundTruth, null, 2) + "\n",
  };
}

export function toPlatformCsv(rows: PlatformTx[]): string {
  const lines = ["tx_id,timestamp,customer_id,amount_raw,currency,status"];
  for (const r of rows) {
    lines.push([r.txId, r.timestamp, r.customerId, unitsToDecimalString(r.amountRaw, 4), r.currency, r.status].join(","));
  }
  return lines.join("\n") + "\n";
}

export function toBankCsv(rows: BankRow[]): string {
  const lines = ["settlement_id,tx_ref,settled_date,settled_amount,currency,type"];
  for (const r of rows) {
    lines.push([r.settlementId, r.txRef, r.settledDate, unitsToDecimalString(r.settledAmount, 2), r.currency, r.type].join(","));
  }
  return lines.join("\n") + "\n";
}
