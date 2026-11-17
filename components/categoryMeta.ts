import type { ExceptionRow, GapCategory, Severity } from "@/lib/types";

export const CATEGORY_LABEL: Record<GapCategory, string> = {
  MATCHED: "Matched",
  TIMING_DIFFERENCE: "Timing difference",
  ROUNDING_DRIFT: "Rounding drift",
  DUPLICATE_SETTLEMENT: "Duplicate settlement",
  ORPHAN_REFUND: "Orphan refund",
  MISSING_SETTLEMENT: "Missing settlement",
  UNMATCHED_CREDIT: "Unmatched credit",
  AMOUNT_MISMATCH: "Amount mismatch",
  LAG_ANOMALY: "Settlement lag",
};

export const CATEGORY_BADGE: Record<GapCategory, string> = {
  MATCHED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  TIMING_DIFFERENCE: "bg-amber-50 text-amber-800 ring-amber-600/25",
  ROUNDING_DRIFT: "bg-sky-50 text-sky-800 ring-sky-600/20",
  DUPLICATE_SETTLEMENT: "bg-violet-50 text-violet-800 ring-violet-600/20",
  ORPHAN_REFUND: "bg-rose-50 text-rose-800 ring-rose-600/25",
  MISSING_SETTLEMENT: "bg-red-50 text-red-800 ring-red-600/25",
  UNMATCHED_CREDIT: "bg-orange-50 text-orange-800 ring-orange-600/25",
  AMOUNT_MISMATCH: "bg-orange-50 text-orange-800 ring-orange-600/25",
  LAG_ANOMALY: "bg-slate-100 text-slate-700 ring-slate-500/20",
};

export const SEVERITY_BADGE: Record<Severity, string> = {
  NONE: "",
  LOW: "text-slate-500",
  MEDIUM: "text-orange-600",
  HIGH: "text-rose-600",
};

export type FilterKey = "ALL" | "MATCHED" | "TIMING" | "ROUNDING" | "DUPLICATE" | "ORPHAN" | "OTHER";

export interface FilterDef {
  key: FilterKey;
  label: string;
  test: (row: ExceptionRow) => boolean;
}

const OTHER: GapCategory[] = ["MISSING_SETTLEMENT", "UNMATCHED_CREDIT", "AMOUNT_MISMATCH", "LAG_ANOMALY"];

export const FILTERS: FilterDef[] = [
  { key: "ALL", label: "All", test: () => true },
  { key: "MATCHED", label: "Matched", test: (r) => r.category === "MATCHED" },
  { key: "TIMING", label: "Timing", test: (r) => r.flags.includes("TIMING_DIFFERENCE") },
  { key: "ROUNDING", label: "Rounding", test: (r) => r.flags.includes("ROUNDING_DRIFT") },
  { key: "DUPLICATE", label: "Duplicate", test: (r) => r.flags.includes("DUPLICATE_SETTLEMENT") },
  { key: "ORPHAN", label: "Orphan Refund", test: (r) => r.flags.includes("ORPHAN_REFUND") },
  { key: "OTHER", label: "Unexplained / other", test: (r) => r.flags.some((f) => OTHER.includes(f)) },
];
