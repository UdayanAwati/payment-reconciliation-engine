"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AssumptionsBanner } from "@/components/AssumptionsBanner";
import type { FilterKey } from "@/components/categoryMeta";
import { ExceptionsTable } from "@/components/ExceptionsTable";
import { SummaryCards } from "@/components/SummaryCards";
import { Toolbar } from "@/components/Toolbar";
import { WaterfallCard } from "@/components/WaterfallCard";
import { generateDataset } from "@/lib/generator";
import { buildReportCsv, downloadTextFile } from "@/lib/report";
import { reconcileCsv } from "@/lib/reconcile";
import type { GroundTruth, ParseIssue, ReconciliationResult } from "@/lib/types";
import { checkRecall } from "@/lib/verify";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

interface Source {
  csv: string;
  label: string;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.text();
}

export default function Home() {
  const [platform, setPlatform] = useState<Source | null>(null);
  const [bank, setBank] = useState<Source | null>(null);
  const [truth, setTruth] = useState<GroundTruth | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [showIssues, setShowIssues] = useState(false);

  const loadShipped = useCallback(async () => {
    setLoadError(null);
    setUploadError(null);
    try {
      const [p, b] = await Promise.all([
        fetchText("/data/platform_transactions.csv"),
        fetchText("/data/bank_settlements.csv"),
      ]);
      setPlatform({ csv: p, label: "shipped data" });
      setBank({ csv: b, label: "shipped data" });
      // Ground truth is optional: it only powers the recall badge.
      try {
        setTruth(JSON.parse(await fetchText("/data/ground_truth.json")) as GroundTruth);
      } catch {
        setTruth(null);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load the shipped CSV files.");
    }
  }, []);

  useEffect(() => {
    void loadShipped();
  }, [loadShipped]);

  const computed = useMemo<{ result: ReconciliationResult; issues: ParseIssue[] } | null>(() => {
    if (!platform || !bank) return null;
    try {
      return reconcileCsv(platform.csv, bank.csv);
    } catch (e) {
      // reconcileCsv is not expected to throw, but never take the dashboard down if it does.
      return {
        result: null as unknown as ReconciliationResult,
        issues: [{ file: "platform", level: "error", message: `Reconciliation failed: ${e instanceof Error ? e.message : String(e)}` }],
      };
    }
  }, [platform, bank]);

  const result = computed?.result ?? null;
  const issues = computed?.issues ?? [];
  const errors = issues.filter((i) => i.level === "error");
  const recall = useMemo(() => (result && truth ? checkRecall(result, truth) : null), [result, truth]);

  const onUpload = async (kind: "platform" | "bank", file: File) => {
    setUploadError(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError(`${file.name} is larger than 10 MB and was not loaded.`);
      return;
    }
    try {
      const text = await file.text();
      const src = { csv: text, label: file.name };
      if (kind === "platform") setPlatform(src);
      else setBank(src);
      setTruth(null); // custom data has no planted anomalies
      setFilter("ALL");
    } catch {
      setUploadError(`Could not read ${file.name}.`);
    }
  };

  const onRegenerate = () => {
    const seed = Math.floor(Math.random() * 1_000_000_000);
    const ds = generateDataset(seed);
    setPlatform({ csv: ds.platformCsv, label: `synthetic, seed ${seed}` });
    setBank({ csv: ds.bankCsv, label: `synthetic, seed ${seed}` });
    setTruth(ds.groundTruth);
    setUploadError(null);
    setFilter("ALL");
  };

  const onDownload = () => {
    if (result) downloadTextFile("reconciliation_report.csv", buildReportCsv(result.rows));
  };

  const recallFound = recall?.reduce((s, r) => s + r.found.length, 0) ?? 0;
  const recallExpected = recall?.reduce((s, r) => s + r.expected.length, 0) ?? 0;

  return (
    <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Payment Reconciliation Engine</h1>
          <p className="text-sm text-slate-500">
            October 2026 · platform ledger vs bank settlements · platform: {platform?.label ?? "loading…"} · bank: {bank?.label ?? "loading…"}
          </p>
        </div>
        <Toolbar
          platformLabel={platform?.label ?? ""}
          bankLabel={bank?.label ?? ""}
          disabled={!result}
          onUpload={onUpload}
          onRegenerate={onRegenerate}
          onReset={() => void loadShipped()}
          onDownload={onDownload}
        />
      </header>

      {loadError && (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Could not load the shipped data ({loadError}). Run <code>npm run generate</code>, upload your own CSVs, or regenerate synthetic data.
        </div>
      )}
      {uploadError && (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {uploadError}
        </div>
      )}

      {issues.length > 0 && (
        <div role="status" className={`rounded-lg border px-4 py-3 text-sm ${errors.length ? "border-rose-200 bg-rose-50 text-rose-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          <div className="flex items-center justify-between gap-3">
            <span>
              {errors.length > 0 ? `${errors.length} file problem(s)` : "Input warnings"} · {issues.length} issue(s) found while reading the CSVs. Unusable rows were skipped.
            </span>
            <button type="button" className="underline" onClick={() => setShowIssues((s) => !s)}>
              {showIssues ? "Hide" : "Details"}
            </button>
          </div>
          {showIssues && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5">
              {issues.map((i, idx) => (
                <li key={idx}>
                  <span className="font-medium">{i.file}</span>
                  {i.line ? ` line ${i.line}` : ""}: {i.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {result?.warnings.map((w) => (
        <div key={w} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {w}
        </div>
      ))}

      {!computed && !loadError && <p className="py-20 text-center text-slate-500">Loading reconciliation data…</p>}

      {result && (
        <>
          <SummaryCards result={result} />
          <WaterfallCard result={result} />
          {recall && (
            <div
              className={`rounded-lg border px-4 py-2 text-sm ${
                recallFound === recallExpected && recall.every((r) => r.extra.length === 0)
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-amber-200 bg-amber-50 text-amber-900"
              }`}
            >
              Ground-truth check: {recallFound} of {recallExpected} planted anomalies detected
              {recall.some((r) => r.extra.length > 0) ? ` (${recall.reduce((s, r) => s + r.extra.length, 0)} extra flagged)` : ""}.{" "}
              {recall.map((r) => `${r.category.replaceAll("_", " ").toLowerCase()} ${r.found.length}/${r.expected.length}`).join(" · ")}
            </div>
          )}
          <AssumptionsBanner options={result.options} />
          <ExceptionsTable rows={result.rows} filter={filter} onFilterChange={setFilter} />
        </>
      )}

      {!result && computed && errors.length > 0 && (
        <p className="py-10 text-center text-slate-500">Fix the file problems above and upload the CSVs again.</p>
      )}
    </main>
  );
}
