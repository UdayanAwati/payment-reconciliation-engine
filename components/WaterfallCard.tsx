import { formatUsd } from "@/lib/money";
import type { ReconciliationResult } from "@/lib/types";

const BAR_COLOR: Record<string, string> = {
  timing: "bg-amber-400",
  rounding: "bg-sky-400",
  duplicates: "bg-violet-400",
  orphans: "bg-rose-400",
};

export function WaterfallCard({ result }: { result: ReconciliationResult }) {
  const steps = result.waterfall;
  const adjustments = steps.filter((s) => s.kind === "adjustment");
  const maxAbs = Math.max(1, ...adjustments.map((s) => Math.abs(s.amount)));

  let running = 0;
  const rows = steps.map((s) => {
    running = s.kind === "total" && s.key === "platform_total" ? s.amount : s.kind === "adjustment" ? running + s.amount : running;
    return { step: s, running };
  });

  const ra = result.roundingAnalysis;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Variance waterfall</h2>
        <p className="text-sm text-slate-500">Platform October Total → Bank October Settled Total</p>
      </div>

      <div className="mt-3 divide-y divide-slate-100">
        {rows.map(({ step, running }) => {
          if (step.kind === "total") {
            return (
              <div key={step.key} className="flex items-center justify-between py-2.5">
                <span className="text-sm font-semibold">{step.label}</span>
                <span className="tabular text-sm font-semibold">{formatUsd(step.amount)}</span>
              </div>
            );
          }
          const isUnexplained = step.key === "unexplained";
          const pct = step.amount === 0 ? 0 : Math.max(2, (Math.abs(step.amount) / maxAbs) * 50);
          const color = isUnexplained ? (step.amount === 0 ? "bg-emerald-500" : "bg-red-500") : BAR_COLOR[step.key];
          return (
            <div key={step.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-3 py-2 text-sm">
              <span className={isUnexplained ? "font-semibold" : "text-slate-600"}>{step.label}</span>
              <div className="relative h-3 rounded bg-slate-50" aria-hidden>
                <div className="absolute inset-y-0 left-1/2 w-px bg-slate-300" />
                {step.amount !== 0 && (
                  <div
                    className={`absolute inset-y-0 rounded ${color}`}
                    style={step.amount > 0 ? { left: "50%", width: `${pct}%` } : { right: "50%", width: `${pct}%` }}
                  />
                )}
              </div>
              <div className="tabular w-44 text-right">
                <span className={`font-medium ${isUnexplained && step.amount === 0 ? "text-emerald-700" : ""}`}>
                  {formatUsd(step.amount, { signed: true })}
                </span>
                <span className="ml-2 text-xs text-slate-400">= {formatUsd(running)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {ra.affectedRows > 0 && (
        <div className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <span className="font-medium">Why rounding drift hides row by row:</span> {ra.affectedRows} rows net to{" "}
          {formatUsd(ra.rowLevelDriftTotal)} at cent level, yet sum(amount_raw) ={" "}
          <span className="tabular">{formatUsd(ra.platformRawSum)}</span> vs sum(settled_amount) ={" "}
          <span className="tabular">{formatUsd(ra.bankSettledSum)}</span>, an aggregate drift of{" "}
          <span className="tabular font-medium">{formatUsd(ra.aggregateDrift, { signed: true })}</span>.
        </div>
      )}
    </section>
  );
}
