import assert from "assert/strict";
import { prepareAnnotationQueue } from "../modules/evaluation/annotation.queue";
import { calculateInterAnnotatorAgreement } from "../modules/evaluation/annotation.agreement";
import { buildAdjudicatedGold } from "../modules/evaluation/annotation.review";
import { validateGoldBenchmark } from "../modules/evaluation/benchmark.gold";

// Fictional unit-test input. This is NOT expert review or research evidence.
const EVIDENCE = "Заяви на умовну програму подаються до 15 серпня включно.";

function syntheticInputs() {
  const ingested = JSON.stringify({
    text: EVIDENCE,
    metadata: {
      documentId: "fictional_admission",
      year: 2026,
      section: "1",
      url: "https://example.org/fictional",
    },
  }) + "\n";
  const queries = JSON.stringify({
    id: "synthetic-eval",
    dataset: [{
      id: "q1",
      query: "Коли закінчується приймання заяв?",
      relevantDocumentIds: ["fictional_admission_2026.txt"],
    }],
  });
  const queue = prepareAnnotationQueue(ingested, queries);
  const sourceId = queue.cases[0].candidateSources[0].id;
  const proof = { sourceId, evidenceQuote: EVIDENCE };

  const review = {
    schemaVersion: "annotation-review/1",
    datasetId: "synthetic-review",
    originDatasetId: queue.originDatasetId,
    corpusSnapshotId: queue.corpusSnapshotId,
    queriesSha256: queue.queriesSha256,
    annotatorIds: ["synthetic-rater-a", "synthetic-rater-b"],
    adjudicatorId: "synthetic-adjudicator",
    cases: [{
      id: "q1",
      split: "dev",
      sourceVersions: [{
        sourceId,
        documentVersion: "fictional-v1",
        verificationNote: "Synthetic fixture only; no real revision checked",
      }],
      claims: [
        {
          id: "c1",
          text: "Заяви подаються до 15 серпня.",
          reviews: [
            { annotatorId: "synthetic-rater-a", verdict: "supported", ...proof },
            { annotatorId: "synthetic-rater-b", verdict: "supported", ...proof },
          ],
          adjudication: { verdict: "supported", ...proof, rationale: "Synthetic support example" },
        },
        {
          id: "c2",
          text: "Заяви подаються до 20 серпня.",
          reviews: [
            { annotatorId: "synthetic-rater-a", verdict: "contradicted", ...proof },
            { annotatorId: "synthetic-rater-b", verdict: "supported", ...proof },
          ],
          adjudication: { verdict: "contradicted", ...proof, rationale: "Synthetic disagreement resolved" },
        },
        {
          id: "c3",
          text: "Діє стипендія.",
          reviews: [
            { annotatorId: "synthetic-rater-a", verdict: "unsupported" },
            { annotatorId: "synthetic-rater-b", verdict: "unsupported" },
          ],
          adjudication: { verdict: "unsupported", rationale: "No source support" },
        },
        {
          id: "c4",
          text: "У деяких випадках можливий виняток.",
          reviews: [
            { annotatorId: "synthetic-rater-a", verdict: "uncertain" },
            { annotatorId: "synthetic-rater-b", verdict: "uncertain" },
          ],
          adjudication: { verdict: "uncertain", rationale: "Synthetic ambiguous example" },
        },
      ],
    }],
  };
  return { queue, review };
}

function testAdjudicationAndKappa() {
  const { queue, review } = syntheticInputs();
  const result = buildAdjudicatedGold(queue, review);
  validateGoldBenchmark(result.gold);
  assert.equal(result.gold.cases[0].claims.length, 4);
  assert.equal(result.gold.cases[0].claims[1].verdict, "contradicted");
  assert.equal(result.gold.cases[0].claims[1].sourceId, queue.cases[0].candidateSources[0].id);
  assert.equal(result.gold.cases[0].sources[0].text, EVIDENCE);
  assert.equal(result.gold.cases[0].sources[0].documentVersion, "fictional-v1");
  assert.deepEqual(result.gold.cases[0].annotatorIds, review.annotatorIds);
  assert.equal(result.gold.cases[0].adjudicatedBy, review.adjudicatorId);
  assert.equal(result.agreement.claimCount, 4);
  assert.equal(result.agreement.disagreements, 1);
  assert.equal(result.agreement.observedAgreement, 0.75);
  assert.equal(result.agreement.expectedAgreement, 0.25);
  assert.ok(Math.abs(result.agreement.cohenKappa! - 2 / 3) < 1e-12);
  const again = buildAdjudicatedGold(queue, review);
  assert.deepEqual(again.gold, result.gold);

  const degenerate = calculateInterAnnotatorAgreement([
    { first: "supported", second: "supported" },
    { first: "supported", second: "supported" },
  ]);
  assert.equal(degenerate.observedAgreement, 1);
  assert.equal(degenerate.expectedAgreement, 1);
  assert.equal(degenerate.cohenKappa, null);
}

function testRejections() {
  const expectInvalid = (mutate: (queue: any, review: any) => void, message: RegExp) => {
    const { queue, review } = syntheticInputs();
    mutate(queue, review);
    assert.throws(() => buildAdjudicatedGold(queue, review), message);
  };
  expectInvalid((_q, r) => { r.corpusSnapshotId = "sha256:other"; }, /snapshot mismatch/);
  expectInvalid((_q, r) => { r.queriesSha256 = "wrong"; }, /snapshot mismatch/);
  expectInvalid((_q, r) => { r.annotatorIds = ["same", "same"]; }, /two distinct annotators/);
  expectInvalid((_q, r) => { r.cases[0].id = "missing"; }, /not present in annotation queue/);
  expectInvalid((_q, r) => { r.cases[0].claims[1].id = "c1"; }, /duplicate claim ID/);
  expectInvalid((_q, r) => { r.cases[0].claims[0].reviews.pop(); }, /two independent decisions/);
  expectInvalid((_q, r) => {
    r.cases[0].claims[0].reviews[1].annotatorId = "synthetic-rater-a";
  }, /duplicate or unknown annotator/);
  expectInvalid((_q, r) => {
    r.cases[0].claims[0].reviews[0].evidenceQuote = "Вигадана цитата не з документа.";
  }, /evidence quote missing from source/);
  expectInvalid((_q, r) => {
    r.cases[0].claims[0].adjudication = { verdict: "supported", rationale: "no quote" };
  }, /sourceId/);
  expectInvalid((_q, r) => {
    r.cases[0].claims[0].adjudication.rationale = "";
  }, /rationale/);
  expectInvalid((_q, r) => {
    r.cases[0].sourceVersions[0].sourceId = "invented-source";
  }, /source not present in annotation queue/);
  expectInvalid((_q, r) => {
    r.cases[0].sourceVersions[0].documentVersion = "";
  }, /documentVersion/);
  expectInvalid((q, _r) => {
    q.cases[0].candidateSources[0].text = "tampered";
  }, /content hash mismatch/);
  expectInvalid((_q, r) => {
    r.cases[0].claims[2].reviews[0].sourceId = r.cases[0].sourceVersions[0].sourceId;
  }, /evidence not allowed/);
  expectInvalid((_q, r) => {
    r.cases[0].claims[0].reviews[0].verdict = "impossible";
  }, /invalid verdict/);
}

testAdjudicationAndKappa();
testRejections();
console.log("Annotation adjudication checks passed (synthetic fixtures only).");
