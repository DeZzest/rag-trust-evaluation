import crypto from "crypto";
import fs from "fs";
import path from "path";
import { buildBenchmarkReport } from "./benchmark.report";

function sha256(raw: string): string {
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

function main(): void {
  const [goldArg, predictionsArg, reportArg] = process.argv.slice(2);
  if (!goldArg || !predictionsArg) {
    console.error(
      "Usage: npm run benchmark:score -- <gold.json> <predictions.json> [report.json]"
    );
    process.exitCode = 2;
    return;
  }
  const goldPath = path.resolve(goldArg);
  const predictionsPath = path.resolve(predictionsArg);
  const reportPath = reportArg ? path.resolve(reportArg) : undefined;

  try {
    if (goldPath === predictionsPath ||
        (reportPath && [goldPath, predictionsPath].includes(reportPath))) {
      throw new Error("benchmark:score: input and output paths must be distinct");
    }
    const rawGold = fs.readFileSync(goldPath, "utf8");
    const rawPredictions = fs.readFileSync(predictionsPath, "utf8");
    const gold: unknown = JSON.parse(rawGold);
    const predictions: unknown = JSON.parse(rawPredictions);
    const result = {
      ...buildBenchmarkReport(gold, predictions),
      provenance: {
        goldFileSha256: sha256(rawGold),
        predictionsFileSha256: sha256(rawPredictions),
        scoringVersion: "1.0",
      },
    };
    if (reportPath) {
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify(result, null, 2) + "\n", {
        encoding: "utf8",
        flag: "wx",
      });
    }
    console.log(JSON.stringify({
      valid: true,
      outputPath: reportPath ?? null,
      ...result,
      caution: "This report measures agreement with the provided labels, not the independent accuracy of those labels.",
    }, null, 2));
  } catch (err) {
    console.error("Benchmark scoring failed:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

if (require.main === module) main();
