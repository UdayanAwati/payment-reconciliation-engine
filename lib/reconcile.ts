import { parseBankCsv, parsePlatformCsv } from "./csv";
import { daysBetween, inRange } from "./dates";
import { formatUsd, roundHalfUpToCents } from "./money";
import type {
  BankRow,
  ExceptionRow,
  GapCategory,
  ParseIssue,
  PlatformTx,
  ReconcileOptions,
  ReconciliationResult,
  Severity,
  WaterfallStep,
} from "./types";

export const DEFAULT_OPTIONS: ReconcileOptions = {
  periodStart: "2026-10-01",
  periodEnd: "2026-10-31",
  cutoffStart: "2026-11-01",
  cutoffEnd: "2026-11-03",
  minLagDays: 1,
  maxLagDays: 2,
};

/** Highest priority first: decides the primary `category` badge when a row has several flags. */
export const CATEGORY_PRIORITY: GapCategory[] = [
  "ORPHAN_REFUND",
  "DUPLICATE_SETTLEMENT",
  "MISSING_SETTLEMENT",
  "AMOUNT_MISMATCH",
  "UNMATCHED_CREDIT",
  "TIMING_DIFFERENCE",
  "ROUNDING_DRIFT",
  "LAG_ANOMALY",
  "MATCHED",
];

const SEVERITY: Record<GapCategory, Severity> = {
  ORPHAN_REFUND: "HIGH",
  DUPLICATE_SETTLEMENT: "HIGH",
  MISSING_SETTLEMENT: "HIGH",
  UNMATCHED_CREDIT: "HIGH",
  AMOUNT_MISMATCH: "MEDIUM",
  TIMING_DIFFERENCE: "LOW",
  ROUNDING_DRIFT: "LOW",
  LAG_ANOMALY: "LOW",
  MATCHED: "NONE",
};
const SEVERITY_RANK: Record<Severity, number> = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };

type Contributions = ExceptionRow["contributions"];
const zero = (): Contributions => ({ timing: 0, rounding: 0, duplicate: 0, orphan: 0, unexplained: 0 });

const byDateThenId = (a: BankRow, b: BankRow) =>
  a.settledDate === b.settledDate ? a.settlementId.localeCompare(b.settlementId) : a.settledDate < b.settledDate ? -1 : 1;

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}

const usd = (units: number) => formatUsd(units);
const usd4 = (units: number) => formatUsd(units, { dp: 4 });

interface Explanation {
  rootCause: string;
  recommendedAction: string;
}

function emptyCounts(): ReconciliationResult["counts"] {
  return {
    MATCHED: 0,
    TIMING_DIFFERENCE: 0,
    ROUNDING_DRIFT: 0,
    DUPLICATE_SETTLEMENT: 0,
    ORPHAN_REFUND: 0,
    MISSING_SETTLEMENT: 0,
    UNMATCHED_CREDIT: 0,
    AMOUNT_MISMATCH: 0,
    LAG_ANOMALY: 0,
    total: 0,
    platformRows: 0,
    bankRows: 0,
  };
}

/**
 * Pure reconciliation of platform transactions against bank settlements.
 *
 * Money is carried as integer units of 1/10,000 USD, so every comparison and sum is exact.
 * Bank rows are grouped by `tx_ref` (never by settlement_id) so duplicate credits with distinct
 * settlement_ids are caught. Each transaction group (or bank-only group) becomes one row whose
 * `contributions` bridge its platform amount to its October bank amount:
 *
 *   platform + timing + rounding + duplicate + orphan + unexplained = bank (October)
 */
export function reconcile(
  platformInput: PlatformTx[],
  bankInput: BankRow[],
  overrides: Partial<ReconcileOptions> = {},
): ReconciliationResult {
  const options: ReconcileOptions = { ...DEFAULT_OPTIONS, ...overrides };
  const { periodStart, periodEnd, cutoffStart, cutoffEnd } = options;
  const inPeriod = (d: string) => inRange(d, periodStart, periodEnd);
  const inCutoff = (d: string) => inRange(d, cutoffStart, cutoffEnd);
  const warnings: string[] = [];

  // --- Scope the platform ledger to the period; keep the first row for any repeated tx_id.
  const platform: PlatformTx[] = [];
  const seenIds = new Set<string>();
  const outOfPeriodRefs = new Set<string>();
  let repeatedIds = 0;
  for (const p of platformInput) {
    if (seenIds.has(p.txId)) {
      repeatedIds++;
      continue;
    }
    seenIds.add(p.txId);
    if (!inPeriod(p.date)) {
      outOfPeriodRefs.add(p.txId);
      continue;
    }
    platform.push(p);
  }
  if (repeatedIds > 0) warnings.push(`${repeatedIds} repeated tx_id row(s) in the platform ledger were ignored (first occurrence kept).`);
  if (outOfPeriodRefs.size > 0) {
    warnings.push(
      `${outOfPeriodRefs.size} platform transaction(s) captured outside ${periodStart}..${periodEnd} were excluded, together with their bank settlements.`,
    );
  }

  const bank = bankInput.filter((b) => !outOfPeriodRefs.has(b.txRef));
  if (platformInput.length === 0) warnings.push("The platform ledger has no usable rows.");
  if (bankInput.length === 0) warnings.push("The bank settlement file has no usable rows.");

  // --- Independent ledger totals (not derived from the per-row results).
  const platformOctoberTotal = platform.reduce((s, p) => s + p.amountRaw, 0);
  const bankOctoberSettledTotal = bank.filter((b) => inPeriod(b.settledDate)).reduce((s, b) => s + b.settledAmount, 0);
  const bankCutoffWindowTotal = bank.filter((b) => inCutoff(b.settledDate)).reduce((s, b) => s + b.settledAmount, 0);

  const octSum = (rows: BankRow[]) => rows.filter((b) => inPeriod(b.settledDate)).reduce((s, b) => s + b.settledAmount, 0);
  const bankByRef = groupBy(bank, (b) => b.txRef);
  const platformByRef = new Map(platform.map((p) => [p.txId, p]));

  const rows: ExceptionRow[] = [];
  /** Per-row pairing delta (primary bank amount - rounded platform amount) for rounding analysis. */
  const pairDelta = new Map<string, number>();

  const finalize = (
    base: Omit<ExceptionRow, "category" | "flags" | "severity" | "rootCause" | "recommendedAction">,
    flagSet: Set<GapCategory>,
    explain: (flag: GapCategory) => Explanation,
  ): ExceptionRow => {
    if (flagSet.size === 0) flagSet.add("MATCHED");
    const flags = CATEGORY_PRIORITY.filter((c) => flagSet.has(c));
    const category = flags[0];
    const severity = flags.reduce<Severity>((acc, f) => (SEVERITY_RANK[SEVERITY[f]] > SEVERITY_RANK[acc] ? SEVERITY[f] : acc), "NONE");
    const parts = flags.map(explain);
    return {
      ...base,
      category,
      flags,
      severity,
      rootCause: parts.map((p) => p.rootCause).join(" "),
      recommendedAction: parts.map((p) => p.recommendedAction).join(" "),
    };
  };

  // --- 1. Every platform transaction in the period.
  for (const p of platform) {
    const all = (bankByRef.get(p.txId) ?? []).slice().sort(byDateThenId);
    const expectedType = p.status === "CAPTURED" ? "CREDIT" : "REFUND";
    const same = all.filter((b) => b.type === expectedType);
    const opposite = all.filter((b) => b.type !== expectedType);
    const primary = same[0];
    const extras = same.slice(1);

    const P = p.amountRaw;
    const E = roundHalfUpToCents(P); // what a correct bank settlement looks like
    const bankOct = octSum(all);

    const c = zero();
    c.rounding = same.length > 0 ? E - P : 0;
    c.timing = primary && inCutoff(primary.settledDate) ? -E : 0;
    c.duplicate = octSum(extras);
    c.unexplained = bankOct - (P + c.rounding + c.timing + c.duplicate);

    const flags = new Set<GapCategory>();
    const primaryOutside = !!primary && !inPeriod(primary.settledDate) && !inCutoff(primary.settledDate);
    if (all.length === 0 || primaryOutside) flags.add("MISSING_SETTLEMENT");
    if (extras.length > 0) flags.add("DUPLICATE_SETTLEMENT");
    if (primary && inCutoff(primary.settledDate)) flags.add("TIMING_DIFFERENCE");
    if (c.rounding !== 0) flags.add("ROUNDING_DRIFT");
    if (opposite.length > 0 || (primary && primary.settledAmount !== E)) flags.add("AMOUNT_MISMATCH");
    if (c.unexplained !== 0 && !flags.has("AMOUNT_MISMATCH") && !flags.has("MISSING_SETTLEMENT")) flags.add("AMOUNT_MISMATCH");
    let lag: number | null = null;
    if (primary && !primaryOutside) {
      lag = daysBetween(p.date, primary.settledDate);
      if (lag < options.minLagDays || lag > options.maxLagDays) flags.add("LAG_ANOMALY");
    }
    if (primary) pairDelta.set(p.txId, primary.settledAmount - E);

    const dupIds = extras.map((b) => b.settlementId);
    const ids = all.map((b) => b.settlementId);
    const explain = (flag: GapCategory): Explanation => {
      switch (flag) {
        case "TIMING_DIFFERENCE":
          return {
            rootCause: `Captured ${p.date}, but the bank settled ${usd(primary!.settledAmount)} on ${primary!.settledDate}, after the ${periodEnd} month-end. The money is in transit, not missing.`,
            recommendedAction: `No loss. Accrue ${usd(E)} as settlements-in-transit at month-end and clear it when the ${primary!.settledDate} bank credit posts.`,
          };
        case "ROUNDING_DRIFT":
          return {
            rootCause: `The platform carries ${usd4(P)}; the bank settles whole cents (${usd(E)}). This row nets to ${usd(bankOct - E)} at cent level, but its ${usd4(E - P)} sub-cent residual accumulates across rows.`,
            recommendedAction: `Post one month-end adjustment for the cumulative rounding drift (see waterfall) to a rounding-difference account; no customer action needed.`,
          };
        case "DUPLICATE_SETTLEMENT":
          return {
            rootCause: `The bank credited tx_ref ${p.txId} ${same.length} times (${same.map((b) => b.settlementId).join(", ")}) while the platform recorded a single ${p.status.toLowerCase()}. Extra amount: ${usd(extras.reduce((s, b) => s + b.settledAmount, 0))}.`,
            recommendedAction: `Ask the bank to reverse duplicate settlement ${dupIds.join(", ")} and hold the extra funds in suspense until returned or refunded.`,
          };
        case "MISSING_SETTLEMENT":
          return all.length === 0
            ? {
                rootCause: `No bank settlement exists for this ${p.status.toLowerCase()} (${usd(E)} expected).`,
                recommendedAction: `Check payout status with the acquirer; keep the receivable open and escalate if not received within the settlement window.`,
              }
            : {
                rootCause: `The bank settled on ${primary!.settledDate}, outside both ${periodStart}..${periodEnd} and the ${cutoffStart}..${cutoffEnd} cutoff window.`,
                recommendedAction: `Confirm the settlement date with the bank; treat ${usd(E)} as outstanding until it lands in an open period.`,
              };
        case "AMOUNT_MISMATCH": {
          const why =
            opposite.length > 0
              ? `The bank has ${opposite.map((b) => `${b.type.toLowerCase()} ${b.settlementId}`).join(", ")} for this tx_ref in the opposite direction to the platform ${p.status.toLowerCase()}.`
              : `The bank amount differs from the expected ${usd(E)}${primary ? ` by ${usd(primary.settledAmount - E)}` : ""}.`;
          return {
            rootCause: why,
            recommendedAction: `Pull the bank's settlement detail (fees, partial settlement, adjustment) and post a correcting entry once the difference is explained.`,
          };
        }
        case "LAG_ANOMALY":
          return {
            rootCause: `Settled ${lag} day(s) after capture; the expected window is T+${options.minLagDays} to T+${options.maxLagDays}.`,
            recommendedAction: `No amount impact. Check for bank holidays or an SLA breach and monitor.`,
          };
        default:
          return {
            rootCause: `Platform and bank agree to the cent and settled within T+${options.minLagDays}/T+${options.maxLagDays}.`,
            recommendedAction: `None. Reconciled.`,
          };
      }
    };

    rows.push(
      finalize(
        {
          key: `p:${p.txId}`,
          txId: p.txId,
          txRef: p.txId,
          settlementIds: ids,
          platformAmount: P,
          bankAmount: bankOct,
          delta: bankOct - E,
          subCentResidual: c.rounding,
          platformDate: p.date,
          settledDates: all.map((b) => b.settledDate),
          contributions: c,
        },
        flags,
        explain,
      ),
    );
  }

  // --- 2. Bank-only groups (tx_ref not on the platform ledger).
  const bankOnlyRefs = [...bankByRef.keys()].filter((ref) => !platformByRef.has(ref)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const ref of bankOnlyRefs) {
    const all = bankByRef.get(ref)!.slice().sort(byDateThenId);
    for (const type of ["REFUND", "CREDIT"] as const) {
      const group = all.filter((b) => b.type === type);
      if (group.length === 0) continue;
      const bankOct = octSum(group);
      const ids = group.map((b) => b.settlementId);
      const dates = group.map((b) => b.settledDate);
      const c = zero();
      const flags = new Set<GapCategory>();
      if (type === "REFUND") {
        // Refund with no matching CAPTURED (or REFUND) platform transaction.
        c.orphan = bankOct;
        flags.add("ORPHAN_REFUND");
      } else {
        c.unexplained = bankOct;
        flags.add("UNMATCHED_CREDIT");
      }
      const total = group.reduce((s, b) => s + b.settledAmount, 0);
      const explain = (flag: GapCategory): Explanation =>
        flag === "ORPHAN_REFUND"
          ? {
              rootCause: `The bank paid out a refund of ${usd(total)} (${ids.join(", ")}) on ${dates.join(", ")} against tx_ref ${ref}, which does not exist in the platform ledger.`,
              recommendedAction: `High priority: confirm whether the refund was issued outside the platform. If unauthorised, dispute it with the bank; meanwhile book ${usd(total)} to a suspense account.`,
            }
          : {
              rootCause: `The bank credited ${usd(total)} (${ids.join(", ")}) for tx_ref ${ref}, which has no platform record.`,
              recommendedAction: `Identify the payer, hold the funds in suspense, then either match to a platform transaction or return them.`,
            };
      rows.push(
        finalize(
          {
            key: `b:${ref}:${type}`,
            txId: null,
            txRef: ref,
            settlementIds: ids,
            platformAmount: null,
            bankAmount: bankOct,
            delta: bankOct,
            subCentResidual: 0,
            platformDate: null,
            settledDates: dates,
            contributions: c,
          },
          flags,
          explain,
        ),
      );
    }
  }

  // --- 3. Order: severity, then category priority, then id.
  rows.sort((a, b) => {
    const s = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (s !== 0) return s;
    const c = CATEGORY_PRIORITY.indexOf(a.category) - CATEGORY_PRIORITY.indexOf(b.category);
    if (c !== 0) return c;
    return (a.txId ?? a.settlementIds[0] ?? "").localeCompare(b.txId ?? b.settlementIds[0] ?? "", undefined, { numeric: true });
  });

  // --- 4. Waterfall: Platform October Total -> Bank October Settled Total.
  let timing = 0;
  let rounding = 0;
  let duplicates = 0;
  let orphans = 0;
  let rowUnexplained = 0;
  for (const r of rows) {
    timing += r.contributions.timing;
    rounding += r.contributions.rounding;
    duplicates += r.contributions.duplicate;
    orphans += r.contributions.orphan;
    rowUnexplained += r.contributions.unexplained;
  }
  const netUnexplained = bankOctoberSettledTotal - (platformOctoberTotal + timing + rounding + duplicates + orphans);
  // The independently computed ledger totals must agree with the sum of per-row residuals.
  const reconciles = netUnexplained === rowUnexplained;
  if (!reconciles) warnings.push("Internal check failed: per-row residuals do not sum to the ledger-level variance.");

  const waterfall: WaterfallStep[] = [
    { key: "platform_total", label: "Platform October Total", amount: platformOctoberTotal, kind: "total" },
    { key: "timing", label: "Timing differences (settle Nov 1–3)", amount: timing, kind: "adjustment" },
    { key: "rounding", label: "Cumulative rounding drift", amount: rounding, kind: "adjustment" },
    { key: "duplicates", label: "Duplicate bank settlements", amount: duplicates, kind: "adjustment" },
    { key: "orphans", label: "Orphan refunds", amount: orphans, kind: "adjustment" },
    { key: "unexplained", label: "Net unexplained variance", amount: netUnexplained, kind: "adjustment" },
    { key: "bank_total", label: "Bank October Settled Total", amount: bankOctoberSettledTotal, kind: "total" },
  ];

  // --- 5. Rounding analysis: row-level vs aggregate view.
  const roundingRows = rows.filter((r) => r.flags.includes("ROUNDING_DRIFT"));
  const platformRawSum = roundingRows.reduce((s, r) => s + (r.platformAmount ?? 0), 0);
  const bankSettledSum = roundingRows.reduce((s, r) => s + roundHalfUpToCents(r.platformAmount ?? 0), 0);
  const roundingAnalysis = {
    affectedRows: roundingRows.length,
    platformRawSum,
    bankSettledSum,
    rowLevelDriftTotal: roundingRows.reduce((s, r) => s + (pairDelta.get(r.txRef) ?? 0), 0),
    aggregateDrift: bankSettledSum - platformRawSum,
  };

  const counts = emptyCounts();
  for (const r of rows) counts[r.category]++;
  counts.total = rows.length;
  counts.platformRows = platform.length;
  counts.bankRows = bank.length;

  return {
    options,
    rows,
    totals: {
      platformOctoberTotal,
      bankOctoberSettledTotal,
      bankCutoffWindowTotal,
      timing,
      rounding,
      duplicates,
      orphans,
      netUnexplained,
      reconciles,
    },
    waterfall,
    roundingAnalysis,
    counts,
    warnings,
  };
}

/** Convenience: parse both CSV texts and reconcile. Never throws on malformed input. */
export function reconcileCsv(
  platformCsv: string,
  bankCsv: string,
  overrides: Partial<ReconcileOptions> = {},
): { result: ReconciliationResult; issues: ParseIssue[] } {
  const p = parsePlatformCsv(platformCsv);
  const b = parseBankCsv(bankCsv);
  return { result: reconcile(p.rows, b.rows, overrides), issues: [...p.issues, ...b.issues] };
}
