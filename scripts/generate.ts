/**
 * CLI: writes the synthetic datasets + ground truth to public/data/.
 *   npm run generate            # default seed (2026)
 *   npm run generate -- 12345   # custom seed
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SEED, generateDataset } from "../lib/generator";

const seedArg = process.argv[2];
const seed = seedArg !== undefined ? Number(seedArg) : DEFAULT_SEED;
if (!Number.isInteger(seed)) {
  console.error(`Invalid seed "${seedArg}": expected an integer.`);
  process.exit(1);
}

const outDir = join(process.cwd(), "public", "data");
mkdirSync(outDir, { recursive: true });

const ds = generateDataset(seed);
writeFileSync(join(outDir, "platform_transactions.csv"), ds.platformCsv);
writeFileSync(join(outDir, "bank_settlements.csv"), ds.bankCsv);
writeFileSync(join(outDir, "ground_truth.json"), ds.groundTruthJson);

console.log(`Seed ${seed}: wrote ${ds.platform.length} platform rows, ${ds.bank.length} bank rows, ground_truth.json -> ${outDir}`);
