import fs from "fs";
import path from "path";
import { validateGoldBenchmark } from "./benchmark.gold";

function main(): void {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npm run benchmark:validate -- path/to/gold.json");
    process.exitCode = 2;
    return;
  }

  try {
    const fullPath = path.resolve(process.cwd(), file);
    const input: unknown = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    const benchmark = validateGoldBenchmark(input);
    const totalClaims = benchmark.cases.reduce((sum, c) => sum + c.claims.length, 0);
    console.log(JSON.stringify({
      valid: true,
      datasetId: benchmark.datasetId,
      corpusSnapshotId: benchmark.corpusSnapshotId,
      caseCount: benchmark.cases.length,
      claimCount: totalClaims,
    }, null, 2));
  } catch (error) {
    console.error("Gold benchmark validation failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (require.main === module) main();
