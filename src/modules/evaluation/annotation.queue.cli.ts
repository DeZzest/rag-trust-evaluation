import fs from "fs";
import path from "path";
import { prepareAnnotationQueue } from "./annotation.queue";

function main(): void {
  const [ingestedArg, queriesArg, outputArg] = process.argv.slice(2);
  if (!ingestedArg) {
    console.error(
      "Usage: npm run benchmark:prepare -- data/ingested_corpus.jsonl [data/eval_queries.json] [data/benchmark/annotation-queue.json]"
    );
    process.exitCode = 2;
    return;
  }

  const ingestedPath = path.resolve(ingestedArg);
  const queriesPath = path.resolve(queriesArg ?? "data/eval_queries.json");
  const outputPath = path.resolve(outputArg ?? "data/benchmark/annotation-queue.json");

  try {
    if (outputPath === ingestedPath || outputPath === queriesPath) {
      throw new Error("output path cannot overwrite an input file");
    }
    const ingested = fs.readFileSync(ingestedPath, "utf8");
    const queries = fs.readFileSync(queriesPath, "utf8");
    const queue = prepareAnnotationQueue(ingested, queries);
    if (queue.cases.every(c => c.candidateSources.length === 0)) {
      throw new Error("no matching document fragments; check corpus versions and document IDs");
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    // Never overwrite a human-edited queue by accident.
    fs.writeFileSync(outputPath, JSON.stringify(queue, null, 2) + "\n", {
      encoding: "utf8",
      flag: "wx",
    });
    console.log(JSON.stringify({
      writtenTo: outputPath,
      originDatasetId: queue.originDatasetId,
      corpusSnapshotId: queue.corpusSnapshotId,
      cases: queue.cases.length,
      casesWithoutCandidates: queue.cases.filter(c => c.candidateSources.length === 0).length,
      missingDocumentRefs: queue.cases.reduce((n, c) => n + c.missingDocumentIds.length, 0),
      annotationStatus: "NEEDS_MANUAL_ANNOTATION",
    }, null, 2));
  } catch (err) {
    console.error("Annotation queue preparation failed:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

if (require.main === module) main();
