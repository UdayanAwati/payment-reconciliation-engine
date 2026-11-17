"use client";

import { useState } from "react";
import type { ReconcileOptions } from "@/lib/types";

export function AssumptionsBanner({ options }: { options: ReconcileOptions }) {
  const [open, setOpen] = useState(true);
  const rules = [
    <>
      <b>Currency:</b> USD only. Rows in any other currency are skipped and reported.
    </>,
    <>
      <b>Settlement lag:</b> T+{options.minLagDays} to T+{options.maxLagDays} calendar days from the capture date (UTC). Anything else
      is flagged as a lag anomaly with no amount impact.
    </>,
    <>
      <b>Precision:</b> the platform records <b>4 decimals</b>; the bank settles <b>2 decimals</b> using ROUND_HALF_UP. Row-level
      differences are compared at cent level; sub-cent residuals are summed separately as rounding drift.
    </>,
    <>
      <b>Period &amp; cutoff:</b> October totals cover {options.periodStart} to {options.periodEnd}. Bank settlements dated{" "}
      {options.cutoffStart} to {options.cutoffEnd} are the cutoff window: they are timing differences, not missing funds.
    </>,
    <>
      <b>Matching:</b> bank rows are grouped by <code>tx_ref</code>, never by <code>settlement_id</code>. A second credit for the same
      tx_ref is a duplicate, even with a different settlement_id.
    </>,
    <>
      <b>Orphan refunds:</b> a bank refund whose tx_ref matches no platform transaction (no CAPTURED original and no REFUND record).
    </>,
    <>
      <b>Signs:</b> refunds are negative on both sides, whatever sign the file uses.
    </>,
  ];
  return (
    <section className="rounded-xl border border-indigo-200 bg-indigo-50/60 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-indigo-900">Reconciliation assumptions</span>
        <span className="text-xs text-indigo-700">{open ? "Hide ▲" : "Show ▼"}</span>
      </button>
      {open && (
        <ul className="list-disc space-y-1.5 px-8 pb-4 text-sm text-indigo-950/90">
          {rules.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
