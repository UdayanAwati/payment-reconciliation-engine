import { toIsoDate } from "./dates";
import { parseUnits } from "./money";
import type { BankRow, ParseIssue, ParseResult, PlatformTx } from "./types";

/** Minimal RFC-4180 CSV tokenizer: quotes, escaped quotes, CRLF/LF, BOM. Never throws. */
export function parseCsv(text: string): { cells: string[]; line: number }[] {
  const out: { cells: string[]; line: number }[] = [];
  if (typeof text !== "string" || text.length === 0) return out;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;
  let sawContent = false;

  const endField = () => {
    cells.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // skip rows that are entirely empty
    if (sawContent || cells.some((c) => c.trim() !== "")) out.push({ cells, line: rowStartLine });
    cells = [];
    sawContent = false;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      sawContent = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\r") {
      if (src[i + 1] === "\n") i++;
      endRow();
      line++;
      rowStartLine = line;
    } else if (ch === "\n") {
      endRow();
      line++;
      rowStartLine = line;
    } else {
      field += ch;
    }
  }
  if (field !== "" || cells.length > 0) endRow();
  return out;
}

interface Table {
  header: string[];
  index: Map<string, number>;
  body: { cells: string[]; line: number }[];
}

function toTable(text: string): Table | null {
  const rows = parseCsv(text);
  if (rows.length === 0) return null;
  const header = rows[0].cells.map((h) => h.trim().toLowerCase());
  const index = new Map<string, number>();
  header.forEach((h, i) => {
    if (h && !index.has(h)) index.set(h, i);
  });
  return { header, index, body: rows.slice(1) };
}

function cell(t: Table, row: { cells: string[] }, col: string): string {
  const i = t.index.get(col);
  return i === undefined ? "" : (row.cells[i] ?? "").trim();
}

function missingColumns(t: Table, required: string[]): string[] {
  return required.filter((c) => !t.index.has(c));
}

const MAX_ISSUES_PER_FILE = 50;

class Issues {
  list: ParseIssue[] = [];
  private suppressed = 0;
  constructor(private file: "platform" | "bank") {}
  add(level: "error" | "warning", message: string, line?: number) {
    if (this.list.length >= MAX_ISSUES_PER_FILE) {
      this.suppressed++;
      return;
    }
    this.list.push({ file: this.file, level, message, line });
  }
  done(): ParseIssue[] {
    if (this.suppressed > 0) {
      this.list.push({ file: this.file, level: "warning", message: `${this.suppressed} further issue(s) not shown.` });
    }
    return this.list;
  }
}

/**
 * Parse platform_transactions.csv. Malformed input never throws: bad files or rows
 * are reported in `issues`, and unusable rows are skipped.
 */
export function parsePlatformCsv(text: string): ParseResult<PlatformTx> {
  const issues = new Issues("platform");
  const table = toTable(text);
  if (!table) {
    issues.add("error", "platform_transactions.csv is empty.");
    return { rows: [], issues: issues.done() };
  }
  const missing = missingColumns(table, ["tx_id", "timestamp", "amount_raw", "status"]);
  if (missing.length) {
    issues.add("error", `platform_transactions.csv is missing required column(s): ${missing.join(", ")}.`);
    return { rows: [], issues: issues.done() };
  }
  for (const opt of ["customer_id", "currency"]) {
    if (!table.index.has(opt)) issues.add("warning", `platform_transactions.csv has no "${opt}" column; defaults will be used.`);
  }

  const rows: PlatformTx[] = [];
  const seen = new Set<string>();
  for (const r of table.body) {
    const txId = cell(table, r, "tx_id");
    const timestamp = cell(table, r, "timestamp");
    const amountStr = cell(table, r, "amount_raw");
    const status = cell(table, r, "status").toUpperCase();
    const currency = (cell(table, r, "currency") || "USD").toUpperCase();

    if (!txId) {
      issues.add("warning", "Row skipped: empty tx_id.", r.line);
      continue;
    }
    const date = toIsoDate(timestamp);
    if (!date) {
      issues.add("warning", `Row ${txId} skipped: invalid timestamp "${timestamp}".`, r.line);
      continue;
    }
    const amount = parseUnits(amountStr);
    if (amount === null) {
      issues.add("warning", `Row ${txId} skipped: invalid amount_raw "${amountStr}".`, r.line);
      continue;
    }
    if (status !== "CAPTURED" && status !== "REFUND") {
      issues.add("warning", `Row ${txId} skipped: unknown status "${status}" (expected CAPTURED or REFUND).`, r.line);
      continue;
    }
    if (currency !== "USD") {
      issues.add("warning", `Row ${txId} skipped: currency ${currency} is not USD.`, r.line);
      continue;
    }
    if (seen.has(txId)) {
      issues.add("warning", `Row ${txId} skipped: duplicate tx_id in platform file.`, r.line);
      continue;
    }
    seen.add(txId);
    rows.push({
      txId,
      timestamp,
      date,
      customerId: cell(table, r, "customer_id"),
      amountRaw: status === "REFUND" ? -Math.abs(amount) : amount,
      currency,
      status,
    });
  }
  return { rows, issues: issues.done() };
}

/** Parse bank_settlements.csv with the same never-throw contract. */
export function parseBankCsv(text: string): ParseResult<BankRow> {
  const issues = new Issues("bank");
  const table = toTable(text);
  if (!table) {
    issues.add("error", "bank_settlements.csv is empty.");
    return { rows: [], issues: issues.done() };
  }
  const missing = missingColumns(table, ["settlement_id", "tx_ref", "settled_date", "settled_amount", "type"]);
  if (missing.length) {
    issues.add("error", `bank_settlements.csv is missing required column(s): ${missing.join(", ")}.`);
    return { rows: [], issues: issues.done() };
  }
  if (!table.index.has("currency")) issues.add("warning", 'bank_settlements.csv has no "currency" column; USD assumed.');

  const rows: BankRow[] = [];
  const seenSettlementRows = new Set<string>();
  for (const r of table.body) {
    const settlementId = cell(table, r, "settlement_id");
    const txRef = cell(table, r, "tx_ref");
    const dateStr = cell(table, r, "settled_date");
    const amountStr = cell(table, r, "settled_amount");
    const type = cell(table, r, "type").toUpperCase();
    const currency = (cell(table, r, "currency") || "USD").toUpperCase();

    if (!settlementId) {
      issues.add("warning", "Row skipped: empty settlement_id.", r.line);
      continue;
    }
    if (!txRef) {
      issues.add("warning", `Settlement ${settlementId} skipped: empty tx_ref.`, r.line);
      continue;
    }
    const settledDate = toIsoDate(dateStr);
    if (!settledDate) {
      issues.add("warning", `Settlement ${settlementId} skipped: invalid settled_date "${dateStr}".`, r.line);
      continue;
    }
    const amount = parseUnits(amountStr);
    if (amount === null) {
      issues.add("warning", `Settlement ${settlementId} skipped: invalid settled_amount "${amountStr}".`, r.line);
      continue;
    }
    if (type !== "CREDIT" && type !== "REFUND") {
      issues.add("warning", `Settlement ${settlementId} skipped: unknown type "${type}" (expected CREDIT or REFUND).`, r.line);
      continue;
    }
    if (currency !== "USD") {
      issues.add("warning", `Settlement ${settlementId} skipped: currency ${currency} is not USD.`, r.line);
      continue;
    }
    // The same settlement_id repeated with identical content is a re-sent file row, not a
    // distinct bank credit; keep a single copy. (Distinct settlement_ids are kept and caught
    // later by tx_ref grouping.)
    const fingerprint = `${settlementId}|${txRef}|${settledDate}|${amount}|${type}`;
    if (seenSettlementRows.has(fingerprint)) {
      issues.add("warning", `Settlement ${settlementId} skipped: exact duplicate row in bank file.`, r.line);
      continue;
    }
    seenSettlementRows.add(fingerprint);
    rows.push({
      settlementId,
      txRef,
      settledDate,
      settledAmount: type === "REFUND" ? -Math.abs(amount) : amount,
      currency,
      type,
    });
  }
  return { rows, issues: issues.done() };
}
