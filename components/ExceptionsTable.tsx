"use client";

import { useMemo, useState } from "react";
import { formatUsd } from "@/lib/money";
import type { ExceptionRow } from "@/lib/types";
import { CATEGORY_BADGE, CATEGORY_LABEL, FILTERS, SEVERITY_BADGE, type FilterKey } from "./categoryMeta";

const PAGE = 100;

export function ExceptionsTable({
  rows,
  filter,
  onFilterChange,
}: {
  rows: ExceptionRow[];
  filter: FilterKey;
  onFilterChange: (f: FilterKey) => void;
}) {
  const [limit, setLimit] = useState(PAGE);

  const counts = useMemo(() => {
    const m = new Map<FilterKey, number>();
    for (const f of FILTERS) m.set(f.key, rows.filter(f.test).length);
    return m;
  }, [rows]);

  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const filtered = useMemo(() => rows.filter(active.test), [rows, active]);
  const visible = filtered.slice(0, limit);

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
        <h2 className="text-base font-semibold">Exceptions</h2>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter exceptions">
          {FILTERS.filter((f) => f.key !== "OTHER" || (counts.get("OTHER") ?? 0) > 0).map((f) => {
            const selected = f.key === filter;
            return (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  onFilterChange(f.key);
                  setLimit(PAGE);
                }}
                className={`rounded-full px-3 py-1 text-sm transition ${
                  selected ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {f.label} <span className={selected ? "text-slate-300" : "text-slate-400"}>{counts.get(f.key) ?? 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">tx_id</th>
              <th className="px-4 py-2 font-medium">settlement_id</th>
              <th className="px-4 py-2 text-right font-medium">Platform amount</th>
              <th className="px-4 py-2 text-right font-medium">Bank amount</th>
              <th className="px-4 py-2 text-right font-medium">Delta</th>
              <th className="px-4 py-2 font-medium">Gap category</th>
              <th className="px-4 py-2 font-medium">Root cause</th>
              <th className="px-4 py-2 font-medium">Recommended action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 align-top">
            {visible.map((r) => (
              <tr key={r.key} className={r.category === "MATCHED" ? "" : "bg-white hover:bg-slate-50"}>
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">
                  {r.txId ?? <span className="text-slate-400">— (ref {r.txRef})</span>}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs">
                  {r.settlementIds.length === 0 ? <span className="text-slate-400">none</span> : r.settlementIds.map((id) => <div key={id}>{id}</div>)}
                </td>
                <td className="tabular whitespace-nowrap px-4 py-2.5 text-right">
                  {r.platformAmount === null ? <span className="text-slate-400">—</span> : formatUsd(r.platformAmount, { dp: 4 })}
                </td>
                <td className="tabular whitespace-nowrap px-4 py-2.5 text-right">{formatUsd(r.bankAmount)}</td>
                <td className="tabular whitespace-nowrap px-4 py-2.5 text-right">
                  <span className={r.delta === 0 ? "text-slate-500" : r.delta < 0 ? "font-medium text-rose-700" : "font-medium text-amber-700"}>
                    {formatUsd(r.delta, { signed: true })}
                  </span>
                  {r.subCentResidual !== 0 && (
                    <div className="text-xs text-sky-700">{formatUsd(r.subCentResidual, { dp: 4, signed: true })} sub-cent</div>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${CATEGORY_BADGE[r.category]}`}>
                    {CATEGORY_LABEL[r.category]}
                  </span>
                  {r.flags.length > 1 && (
                    <div className="mt-1 text-xs text-slate-400">+ {r.flags.slice(1).map((f) => CATEGORY_LABEL[f]).join(", ")}</div>
                  )}
                  {r.severity !== "NONE" && (
                    <div className={`mt-1 text-[11px] font-semibold uppercase tracking-wide ${SEVERITY_BADGE[r.severity]}`}>{r.severity} severity</div>
                  )}
                </td>
                <td className="max-w-xs px-4 py-2.5 text-slate-700">{r.rootCause}</td>
                <td className="max-w-xs px-4 py-2.5 text-slate-700">{r.recommendedAction}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  No rows in this category.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
        <span>
          Showing {visible.length} of {filtered.length}
        </span>
        {visible.length < filtered.length && (
          <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="rounded-md bg-slate-100 px-3 py-1 text-slate-700 hover:bg-slate-200">
            Show {Math.min(PAGE, filtered.length - visible.length)} more
          </button>
        )}
      </div>
    </section>
  );
}
