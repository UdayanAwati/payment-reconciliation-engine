import { unitsToDecimalString } from "./money";
import type { ExceptionRow } from "./types";

/** Neutralise spreadsheet formula injection for free-text cells that may come from uploaded files. */
function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function esc(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Build reconciliation_report.csv (all rows, including matched ones). */
export function buildReportCsv(rows: ExceptionRow[]): string {
  const header = [
    "tx_id",
    "settlement_id",
    "platform_amount",
    "bank_amount",
    "delta",
    "sub_cent_residual",
    "gap_category",
    "all_flags",
    "severity",
    "root_cause",
    "recommended_action",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        esc(safeText(r.txId ?? "")),
        esc(safeText(r.settlementIds.join(" | "))),
        r.platformAmount === null ? "" : unitsToDecimalString(r.platformAmount, 4),
        unitsToDecimalString(r.bankAmount, 2),
        unitsToDecimalString(r.delta, 2),
        unitsToDecimalString(r.subCentResidual, 4),
        r.category,
        r.flags.join(" | "),
        r.severity,
        esc(safeText(r.rootCause)),
        esc(safeText(r.recommendedAction)),
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}

export function downloadTextFile(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
