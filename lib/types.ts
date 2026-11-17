export type PlatformStatus = "CAPTURED" | "REFUND";
export type BankType = "CREDIT" | "REFUND";

/** A platform ledger row. Amounts are integer units of 1/10,000 USD (see money.ts). */
export interface PlatformTx {
  txId: string;
  /** Original ISO timestamp from the CSV (interpreted as UTC). */
  timestamp: string;
  /** YYYY-MM-DD taken from the timestamp. */
  date: string;
  customerId: string;
  /** Signed: REFUND rows are always negative. */
  amountRaw: number;
  currency: string;
  status: PlatformStatus;
}

/** A bank settlement row. Amounts are integer units of 1/10,000 USD. */
export interface BankRow {
  settlementId: string;
  txRef: string;
  /** YYYY-MM-DD */
  settledDate: string;
  /** Signed: REFUND rows are always negative. */
  settledAmount: number;
  currency: string;
  type: BankType;
}

export type GapCategory =
  | "MATCHED"
  | "TIMING_DIFFERENCE"
  | "ROUNDING_DRIFT"
  | "DUPLICATE_SETTLEMENT"
  | "ORPHAN_REFUND"
  | "MISSING_SETTLEMENT"
  | "UNMATCHED_CREDIT"
  | "AMOUNT_MISMATCH"
  | "LAG_ANOMALY";

export type Severity = "NONE" | "LOW" | "MEDIUM" | "HIGH";

export interface ParseIssue {
  file: "platform" | "bank";
  level: "error" | "warning";
  /** 1-based CSV line number when the issue is tied to a row. */
  line?: number;
  message: string;
}

export interface ParseResult<T> {
  rows: T[];
  issues: ParseIssue[];
}

export interface GroundTruth {
  seed: number;
  period: { start: string; end: string; cutoffStart: string; cutoffEnd: string };
  anomalies: {
    TIMING_DIFFERENCE: { tx_ids: string[]; settlement_ids: string[]; expected_timing_total: number };
    ROUNDING_DRIFT: {
      tx_ids: string[];
      settlement_ids: string[];
      platform_total: number;
      bank_total: number;
      expected_aggregate_drift: number;
      expected_row_level_drift: number;
    };
    DUPLICATE_SETTLEMENT: {
      tx_ids: string[];
      /** Every settlement_id involved (both the original and the duplicate). */
      settlement_ids: string[];
      /** The second, redundant settlement_id for each transaction. */
      duplicate_settlement_ids: string[];
      expected_duplicate_total: number;
    };
    ORPHAN_REFUND: { tx_refs: string[]; settlement_ids: string[]; expected_orphan_total: number };
  };
}

export interface ReconcileOptions {
  /** Reconciliation period, inclusive (YYYY-MM-DD). */
  periodStart: string;
  periodEnd: string;
  /** Cutoff buffer: settlements dated in this window are treated as timing differences. */
  cutoffStart: string;
  cutoffEnd: string;
  /** Expected settlement lag in calendar days (inclusive). */
  minLagDays: number;
  maxLagDays: number;
}

export interface ExceptionRow {
  /** Unique key for React lists. */
  key: string;
  txId: string | null;
  /** tx_id for platform rows, tx_ref for bank-only rows (e.g. orphan refunds). Always set. */
  txRef: string;
  /** All settlement ids involved, e.g. both ids of a duplicate pair. */
  settlementIds: string[];
  /** Original 4dp platform amount (units), null when there is no platform row. */
  platformAmount: number | null;
  /** Bank amount settled inside the reconciliation period (units). */
  bankAmount: number;
  /** Row-level delta at cent precision: bankAmount - ROUND_HALF_UP(platformAmount). */
  delta: number;
  /** Sub-cent residual from rounding: ROUND_HALF_UP(platform) - platform (units). */
  subCentResidual: number;
  category: GapCategory;
  /** Every gap this row exhibits; `category` is the highest-priority one. */
  flags: GapCategory[];
  severity: Severity;
  rootCause: string;
  recommendedAction: string;
  /** Dates for context. */
  platformDate: string | null;
  settledDates: string[];
  /** How this row's gap feeds the waterfall (units). They sum with platform to bankAmount. */
  contributions: {
    timing: number;
    rounding: number;
    duplicate: number;
    orphan: number;
    unexplained: number;
  };
}

export interface WaterfallStep {
  key: "platform_total" | "timing" | "rounding" | "duplicates" | "orphans" | "unexplained" | "bank_total";
  label: string;
  /** For totals: the absolute total. For adjustments: the signed adjustment. */
  amount: number;
  kind: "total" | "adjustment";
}

export interface ReconciliationResult {
  options: ReconcileOptions;
  rows: ExceptionRow[];
  totals: {
    platformOctoberTotal: number;
    bankOctoberSettledTotal: number;
    /** Bank settlements dated inside the Nov cutoff window (informational). */
    bankCutoffWindowTotal: number;
    timing: number;
    rounding: number;
    duplicates: number;
    orphans: number;
    netUnexplained: number;
    /** platform + explained + unexplained === bank */
    reconciles: boolean;
  };
  waterfall: WaterfallStep[];
  /** Row-level vs aggregate view that isolates rounding drift. */
  roundingAnalysis: {
    affectedRows: number;
    /** sum(amount_raw) for rounding rows */
    platformRawSum: number;
    /** sum(ROUND_HALF_UP(amount_raw)) for rounding rows, i.e. what the bank settles */
    bankSettledSum: number;
    /** Sum of cent-level row deltas (should be 0.00). */
    rowLevelDriftTotal: number;
    /** bankSettledSum - platformRawSum (e.g. -0.10). */
    aggregateDrift: number;
  };
  counts: Record<GapCategory, number> & { total: number; platformRows: number; bankRows: number };
  warnings: string[];
}
