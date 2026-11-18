import fs from "fs";
import path from "path";
import { inspectCorpusQuality } from "./corpus.quality";

function main(): void {
  const [inputArg, queueArg, outputArg] = process.argv.slice(2);
  if (!inputArg) {
    console.error(
      "Usage: npx ts-node src/modules/evaluation/corpus.quality.cli.ts <ingested.jsonl> [annotation-queue.json] [report.json]"
    );
    process.exitCode = 2;
    return;
  }

  const inputPath = path.resolve(inputArg);
  const queuePath = queueArg ? path.resolve(queueArg) : undefined;
  const outputPath = outputArg ? path.resolve(outputArg) : undefined;
  try {
    if ((queuePath && queuePath === inputPath) ||
        (outputPath && [inputPath, queuePath].includes(outputPath))) {
      throw new Error("input and output paths must differ");
    }
    const corpus = fs.readFileSync(inputPath, "utf8");
    const queue: unknown = queuePath
      ? JSON.parse(fs.readFileSync(queuePath, "utf8"))
      : undefined;
    const report = inspectCorpusQuality(corpus, queue);

    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n", {
        encoding: "utf8", flag: "wx",
      });
    }
    console.log(JSON.stringify({ ...report, writtenTo: outputPath ?? null }, null, 2));
  } catch (error) {
    console.error("Corpus quality inspection failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
if (require.main === module) main();
