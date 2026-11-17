# Prompts Used — Payment Reconciliation Engine

## Raw Prompt
Make a payment reconciliation app in Next.js or Python that generates dummy data for October with platform transactions and bank settlements (with a 1-2 day settlement delay). Plant 4 types of gaps: transactions settling in November, rounding differences that only show up when summed, duplicate entries in one dataset, and refunds with no matching original transaction. Build a dashboard to show where the gaps are and write tests to verify it works.

---

## Distilled Prompt
Build a complete, production-style Payment Reconciliation Engine & Dashboard using Next.js (App Router), TypeScript, and Tailwind CSS in the current directory.

### 1. DETERMINISTIC SYNTHETIC DATA GENERATOR (`lib/generator.ts` + CLI script)
Generate two realistic CSV datasets for October 2026 (plus early Nov cutoff buffer) and save them to `/public/data/` so the app loads them automatically on startup, while also allowing users to regenerate data or upload their own CSVs:

- `platform_transactions.csv`: ~100 rows (`tx_id,timestamp,customer_id,amount_raw,currency,status`) where `amount_raw` has 4 decimal places and `status` is `CAPTURED` or `REFUND`.
- `bank_settlements.csv`: corresponding bank rows (`settlement_id,tx_ref,settled_date,settled_amount,currency,type`) with a standard 1–2 day settlement lag, `settled_amount` rounded to 2 decimal places (`ROUND_HALF_UP`), and `type` as `CREDIT` or `REFUND`.

Explicitly plant these 4 exact anomaly scenarios (and output a `ground_truth.json` file listing their IDs so tests can verify 100% recall):
1. **Next-Month Cutoff (`TIMING_DIFFERENCE`)**: 3 transactions captured on `2026-10-30` and `2026-10-31` that settle on `2026-11-01` and `2026-11-02`.
2. **Cumulative Rounding Drift (`ROUNDING_DRIFT`)**: 25 micro-transactions each with `amount_raw = 10.0040` on the platform (`$250.10` total) that settle individually as `10.00` at the bank (`$250.00` total)—showing `$0.00` variance row-by-row, but a `-$0.10` variance when summed.
3. **Duplicate Bank Entry (`DUPLICATE_SETTLEMENT`)**: 2 platform transactions that each appear twice in `bank_settlements.csv` with the same `tx_ref` and same `settled_amount`, but **different** `settlement_id`s (e.g., `STL_9042A` and `STL_9042B`).
4. **Orphan Refund (`ORPHAN_REFUND`)**: 2 `REFUND` rows (negative `settled_amount`) in `bank_settlements.csv` whose `tx_ref` (e.g., `TX_9998`, `TX_9999`) does not exist anywhere in `platform_transactions.csv`.

### 2. RECONCILIATION ENGINE (`lib/reconcile.ts`)
Write pure, well-typed reconciliation logic that:
- Groups bank settlements by `tx_ref` (so duplicate credits with distinct `settlement_id`s are caught).
- Separates October-settled vs. November cutoff-buffer settlements (`2026-11-01` to `2026-11-03`) so cross-month settlements are flagged as `TIMING_DIFFERENCE` rather than missing funds.
- Computes both **row-level differences** and **aggregate ledger sums** (`sum(amount_raw)` vs `sum(settled_amount)`) to isolate `ROUNDING_DRIFT`.
- Flags `ORPHAN_REFUND` whenever a bank refund has no matching `CAPTURED` platform transaction.
- Produces a **Variance Waterfall** bridging `Platform October Total` -> `Bank October Settled Total` via each gap category so `Net Unexplained Variance` resolves cleanly to `$0.00` when all anomalies are accounted for.

### 3. INTERACTIVE DASHBOARD (`app/page.tsx`)
- **Top Summary & Variance Waterfall Cards**: Show Platform Volume, Bank Settled Volume, Explained Discrepancies breakdown (Timing, Rounding, Duplicates, Orphan Refunds), and Net Unexplained Variance.
- **Assumptions Banner**: A collapsible card clearly stating the system's reconciliation rules (USD, T+1/T+2 lag, 4-decimal vs 2-decimal rounding, Nov 1–3 cutoff window).
- **Filterable Exceptions Table**: Filter by All / Matched / Timing / Rounding / Duplicate / Orphan Refund. Display `tx_id`, `settlement_id`, Platform Amount, Bank Amount, Delta, Gap Category badge, Plain-English Root Cause, and Recommended Accounting Action.
- **CSV Upload & Export**: Allow uploading custom `platform_transactions.csv` and `bank_settlements.csv` files, regenerating synthetic data, and downloading `reconciliation_report.csv`.

### 4. AUTOMATED TEST SUITE (`__tests__/reconcile.test.ts`)
Set up Vitest and write unit tests verifying:
1. Exact match within T+1/T+2 window.
2. Cross-month Oct 31 -> Nov 2 transaction classified as `TIMING_DIFFERENCE`.
3. Cumulative rounding drift (`25 * 10.0040` vs `25 * 10.00` = `-$0.10` aggregate drift, `$0.00` row drift).
4. Duplicate bank settlement with different `settlement_id`s caught via `tx_ref` grouping.
5. Orphan refund caught with high severity.
6. Malformed/missing CSV columns handled gracefully without crashing.
