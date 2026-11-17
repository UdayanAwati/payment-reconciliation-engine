import { formatUsd } from "@/lib/money";
import type { ReconciliationResult } from "@/lib/types";

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

export function SummaryCards({ result }: { result: ReconciliationResult }) {
  const t = result.totals;
  const c = result.counts;
  const unexplainedZero = t.netUnexplained === 0;

  const explained: { label: string; amount: number; count: number; dot: string }[] = [
    { label: "Timing (Nov 1–3 settlements)", amount: t.timing, count: c.TIMING_DIFFERENCE, dot: "bg-amber-400" },
    { label: "Rounding drift", amount: t.rounding, count: c.ROUNDING_DRIFT, dot: "bg-sky-400" },
    { label: "Duplicate settlements", amount: t.duplicates, count: c.DUPLICATE_SETTLEMENT, dot: "bg-violet-400" },
    { label: "Orphan refunds", amount: t.orphans, count: c.ORPHAN_REFUND, dot: "bg-rose-400" },
  ];
  const explainedTotal = t.timing + t.rounding + t.duplicates + t.orphans;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card title="Platform volume (October)">
        <p className="tabular mt-2 text-2xl font-semibold">{formatUsd(t.platformOctoberTotal)}</p>
        <p className="mt-1 text-sm text-slate-500">{c.platformRows} transactions, net of refunds</p>
      </Card>

      <Card title="Bank settled volume (October)">
        <p className="tabular mt-2 text-2xl font-semibold">{formatUsd(t.bankOctoberSettledTotal)}</p>
        <p className="mt-1 text-sm text-slate-500">
          {formatUsd(t.bankCutoffWindowTotal)} more settled Nov 1–3 (cutoff buffer)
        </p>
      </Card>

      <Card title="Explained discrepancies">
        <ul className="mt-2 space-y-1.5 text-sm">
          {explained.map((e) => (
            <li key={e.label} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-slate-600">
                <span className={`h-2 w-2 rounded-full ${e.dot}`} />
                {e.label}
                <span className="text-xs text-slate-400">×{e.count}</span>
              </span>
              <span className="tabular font-medium">{formatUsd(e.amount, { signed: true })}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-sm font-semibold">
          <span>Total explained</span>
          <span className="tabular">{formatUsd(explainedTotal, { signed: true })}</span>
        </div>
      </Card>

      <Card
        title="Net unexplained variance"
        className={unexplainedZero ? "border-emerald-200 bg-emerald-50/60" : "border-rose-200 bg-rose-50/60"}
      >
        <p className={`tabular mt-2 text-3xl font-semibold ${unexplainedZero ? "text-emerald-700" : "text-rose-700"}`}>
          {formatUsd(t.netUnexplained)}
        </p>
        <p className={`mt-1 text-sm ${unexplainedZero ? "text-emerald-700" : "text-rose-700"}`}>
          {unexplainedZero
            ? "Every dollar of difference is accounted for."
            : "Some of the difference has no matching explanation. Review the flagged rows."}
        </p>
      </Card>
    </div>
  );
}
