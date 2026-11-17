"use client";

import { useRef } from "react";

interface Props {
  platformLabel: string;
  bankLabel: string;
  disabled: boolean;
  onUpload: (kind: "platform" | "bank", file: File) => void;
  onRegenerate: () => void;
  onReset: () => void;
  onDownload: () => void;
}

const btn =
  "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

export function Toolbar({ platformLabel, bankLabel, disabled, onUpload, onRegenerate, onReset, onDownload }: Props) {
  const platformRef = useRef<HTMLInputElement>(null);
  const bankRef = useRef<HTMLInputElement>(null);

  const handle = (kind: "platform" | "bank") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(kind, file);
    e.target.value = ""; // allow re-selecting the same file
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input ref={platformRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handle("platform")} />
      <input ref={bankRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handle("bank")} />
      <button type="button" className={btn} onClick={() => platformRef.current?.click()} title={platformLabel}>
        Upload platform_transactions.csv
      </button>
      <button type="button" className={btn} onClick={() => bankRef.current?.click()} title={bankLabel}>
        Upload bank_settlements.csv
      </button>
      <button type="button" className={btn} onClick={onRegenerate}>
        Regenerate synthetic data
      </button>
      <button type="button" className={btn} onClick={onReset}>
        Reset to shipped data
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onDownload}
        className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Download reconciliation_report.csv
      </button>
    </div>
  );
}
