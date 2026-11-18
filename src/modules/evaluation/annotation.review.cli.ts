import fs from "fs";
import path from "path";
import { buildAdjudicatedGold } from "./annotation.review";

function main(): void {
  const [queueArg, reviewArg, goldArg] = process.argv.slice(2);
  if (!queueArg || !reviewArg) {
    console.error(
      "Usage: npm run benchmark:adjudicate -- <queue.json> <review.json> [gold-output.json]"
    );
    process.exitCode = 2;
    return;
  }

  const queuePath = path.resolve(queueArg);
  const reviewPath = path.resolve(reviewArg);
  const goldPath = goldArg ? path.resolve(goldArg) : undefined;
  try {
    if (queuePath === reviewPath ||
        (goldPath && [queuePath, reviewPath].includes(goldPath))) {
      throw new Error("input and output paths must be distinct");
    }
    const queue: unknown = JSON.parse(fs.readFileSync(queuePath, "utf8"));
    const review: unknown = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
    const result = buildAdjudicatedGold(queue, review);
    // Review-only operation unless a path is explicitly supplied.
    if (goldPath) {
      fs.mkdirSync(path.dirname(goldPath), { recursive: true });
      fs.writeFileSync(goldPath, JSON.stringify(result.gold, null, 2) + "\n", {
        encoding: "utf8",
        flag: "wx",
      });
    }
    console.log(JSON.stringify({
      validation: "passed",
      goldWrittenTo: goldPath ?? null,
      datasetId: result.gold.datasetId,
      corpusSnapshotId: result.gold.corpusSnapshotId,
      goldCases: result.gold.cases.length,
      claimCount: result.agreement.claimCount,
      interAnnotatorAgreementBeforeAdjudication: result.agreement,
      note: "IDs and quoted source text validated; reviewer independence and verdict correctness require human verification.",
    }, null, 2));
  } catch (error) {
    console.error("Adjudication failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (require.main === module) main();
