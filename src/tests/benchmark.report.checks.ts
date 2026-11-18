import assert from "assert/strict";
import { GoldBenchmark } from "../modules/evaluation/benchmark.gold";
import { buildBenchmarkReport } from "../modules/evaluation/benchmark.report";

const PROOF = "Умовний наказ встановлює кінцевий термін 15 серпня.";

function fictionalGold(): GoldBenchmark {
  return {
    schemaVersion: "1.0",
    datasetId: "synthetic-report-fixture",
    corpusSnapshotId: "synthetic-only-corpus",
    cases: [
      {
        id: "c-dev",
        query: "Яка умовна дата завершення приймання?",
        split: "dev",
        annotatorIds: ["r1", "r2"],
        adjudicatedBy: "arbiter",
        sources: [{
          id: "s-dev", documentId: "fictional-policy",
          documentVersion: "fictional-v1", text: PROOF,
        }],
        claims: [
          { id: "cl1", text: "Кінцевий термін — 15 серпня.", verdict: "supported", sourceId: "s-dev", evidenceQuote: PROOF },
          { id: "cl2", text: "Кінцевий термін — 20 серпня.", verdict: "contradicted", sourceId: "s-dev", evidenceQuote: PROOF },
        ],
      },
      {
        id: "c-test",
        query: "Що відомо про умовну стипендію?",
        split: "test",
        annotatorIds: ["r1", "r2"],
        adjudicatedBy: "arbiter",
        sources: [{
          id: "s-test", documentId: "fictional-policy",
          documentVersion: "fictional-v1", text: PROOF,
        }],
        claims: [
          { id: "cl3", text: "Є спеціальна стипендія.", verdict: "unsupported" },
          { id: "cl4", text: "Окремі винятки допускаються.", verdict: "uncertain" },
        ],
      },
    ],
  };
}

function fictionalPredictions() {
  return {
    schemaVersion: "claim-predictions/1",
    datasetId: "synthetic-report-fixture",
    corpusSnapshotId: "synthetic-only-corpus",
    runId: "fictional-run-1",
    methodId: "fictional-rules-baseline",
    modelId: "none-synthetic",
    evaluationMode: "gold_claim_classification",
    configuration: { purpose: "synthetic-test-only", seed: 42 },
    predictions: [
      { caseId: "c-dev", claimId: "cl1", verdict: "supported" },
      { caseId: "c-dev", claimId: "cl2", verdict: "supported" },
      { caseId: "c-test", claimId: "cl3", verdict: "unsupported" },
      { caseId: "c-test", claimId: "cl4", verdict: "uncertain" },
    ],
  };
}

function testReport(): void {
  const gold = fictionalGold();
  const predictions = fictionalPredictions();
  const report = buildBenchmarkReport(gold, predictions);
  assert.equal(report.schemaVersion, "benchmark-report/1");
  assert.equal(report.datasetId, gold.datasetId);
  assert.equal(report.corpusSnapshotId, gold.corpusSnapshotId);
  assert.equal(report.overall.caseCount, 2);
  assert.equal(report.overall.claimCount, 4);
  assert.equal(report.overall.metrics.accuracy, 0.75);
  assert.equal(report.overall.metrics.missedContradictions, 1);
  assert.equal(report.dev?.caseCount, 1);
  assert.equal(report.dev?.claimCount, 2);
  assert.equal(report.dev?.metrics.accuracy, 0.5);
  assert.equal(report.dev?.metrics.contradictionMissRate, 1);
  assert.equal(report.test?.caseCount, 1);
  assert.equal(report.test?.claimCount, 2);
  assert.equal(report.test?.metrics.accuracy, 1);
  assert.equal(report.test?.metrics.perClass.unsupported.support, 1);
  assert.deepEqual(buildBenchmarkReport(gold, predictions), report);

  const devOnlyGold = fictionalGold();
  devOnlyGold.cases = devOnlyGold.cases.filter(c => c.split === "dev");
  const devPredictions = fictionalPredictions();
  devPredictions.predictions = devPredictions.predictions.filter(p => p.caseId === "c-dev");
  assert.equal(buildBenchmarkReport(devOnlyGold, devPredictions).test, null);
}

function testInvalidInputs(): void {
  const check = (mutate: (g: any, p: any) => void, error: RegExp) => {
    const g = fictionalGold();
    const p = fictionalPredictions();
    mutate(g, p);
    assert.throws(() => buildBenchmarkReport(g, p), error);
  };
  check((_g, p) => { p.datasetId = "other"; }, /dataset or corpus snapshot mismatch/);
  check((_g, p) => { p.corpusSnapshotId = "other"; }, /dataset or corpus snapshot mismatch/);
  check((_g, p) => { p.runId = ""; }, /runId/);
  check((_g, p) => { p.methodId = ""; }, /methodId/);
  check((_g, p) => { p.modelId = ""; }, /modelId/);
  check((_g, p) => { p.evaluationMode = "unknown"; }, /evaluationMode/);
  check((_g, p) => { p.configuration = {}; }, /configuration/);
  check((_g, p) => { p.schemaVersion = "wrong"; }, /schemaVersion/);
  check((_g, p) => { p.predictions.pop(); }, /missing records/);
  check((_g, p) => { p.predictions.push({ ...p.predictions[0] }); }, /duplicate caseId\/claimId/);
  check((_g, p) => { p.predictions[0].claimId = "fake"; }, /unknown caseId\/claimId/);
  check((_g, p) => { p.predictions[0].verdict = "nonsense"; }, /invalid prediction/);
}

testReport();
testInvalidInputs();
console.log("Benchmark report checks passed (synthetic fixtures only).");
