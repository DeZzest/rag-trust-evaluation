import fs from "fs";
import path from "path";
import { auditCorpusReadiness } from "./corpus.readiness";

function main(): void {
  const [corpusArg, queueArg, reportArg] = process.argv.slice(2);
  if (!corpusArg || !queueArg) {
    console.error(
      "Usage: npm run benchmark:audit -- <ingested.jsonl> <annotation-queue.json> [report.json]"
    );
    process.exitCode = 2;
    return;
  }
  const corpusPath = path.resolve(corpusArg);
  const queuePath = path.resolve(queueArg);
  const reportPath = reportArg ? path.resolve(reportArg) : undefined;

  try {
    if (corpusPath === queuePath ||
        (reportPath && [corpusPath, queuePath].includes(reportPath))) {
      throw new Error("readiness: input and output paths must be distinct");
    }
    const corpus = fs.readFileSync(corpusPath, "utf8");
    const queue: unknown = JSON.parse(fs.readFileSync(queuePath, "utf8"));
    const report = auditCorpusReadiness(corpus, queue);
    if (reportPath) {
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", {
        flag: "wx", encoding: "utf8",
      });
    }
    console.log(JSON.stringify({
      ...report,
      writtenTo: reportPath ?? null,
      warning: "Metadata years and source quotations are not independent verification of document legal validity.",
    }, null, 2));
  } catch (error) {
    console.error("Corpus readiness audit failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (require.main === module) main();
