# Payment Reconciliation Engine & Dashboard

Next.js (App Router) + TypeScript + Tailwind. Reconciles a platform ledger (4-decimal amounts) against bank
settlements (2-decimal, ROUND_HALF_UP) for October 2026 and explains every variance.

```bash
npm install
npm run generate     # writes public/data/{platform_transactions,bank_settlements}.csv + ground_truth.json
npm test             # Vitest
npm run build && npm start
npm run dev          # http://localhost:3000
```

- `lib/generator.ts` – deterministic (seeded) data + the 4 planted anomalies; `scripts/generate.ts` is the CLI.
- `lib/reconcile.ts` – pure engine: groups bank rows by `tx_ref`, Nov 1–3 cutoff window, row-level vs aggregate rounding, variance waterfall.
- `lib/money.ts` – all money is integer units of 1/10,000 USD, so sums are exact (25 × 10.0040 = 250.1000).
- `lib/csv.ts` – tolerant CSV parsing; bad files/rows are reported, never thrown.
- Dashboard: upload your own CSVs, regenerate synthetic data (new random seed), download `reconciliation_report.csv`.

`dev`/`build` use `--webpack`; remove the flag to use Turbopack where your environment supports it.
