import type { GapCategory, GroundTruth, ReconciliationResult } from "./types";

export interface RecallResult {
  category: "TIMING_DIFFERENCE" | "ROUNDING_DRIFT" | "DUPLICATE_SETTLEMENT" | "ORPHAN_REFUND";
  expected: string[];
  found: string[];
  missed: string[];
  /** Rows flagged with this category that the ground truth does not list. */
  extra: string[];
}

/** Compare the engine's findings against the planted ground truth, per scenario. */
export function checkRecall(result: ReconciliationResult, truth: GroundTruth): RecallResult[] {
  const expectedBy: Record<RecallResult["category"], string[]> = {
    TIMING_DIFFERENCE: truth.anomalies.TIMING_DIFFERENCE.tx_ids,
    ROUNDING_DRIFT: truth.anomalies.ROUNDING_DRIFT.tx_ids,
    DUPLICATE_SETTLEMENT: truth.anomalies.DUPLICATE_SETTLEMENT.tx_ids,
    ORPHAN_REFUND: truth.anomalies.ORPHAN_REFUND.tx_refs,
  };
  return (Object.keys(expectedBy) as RecallResult["category"][]).map((category) => {
    const flagged = new Set(result.rows.filter((r) => r.flags.includes(category as GapCategory)).map((r) => r.txRef));
    const expected = expectedBy[category];
    const found = expected.filter((id) => flagged.has(id));
    return {
      category,
      expected,
      found,
      missed: expected.filter((id) => !flagged.has(id)),
      extra: [...flagged].filter((id) => !expected.includes(id)),
    };
  });
}
