import assert from "assert/strict";
import { GoldBenchmark, validateGoldBenchmark } from "../modules/evaluation/benchmark.gold";
import { scoreClaimPredictions, ClaimPrediction } from "../modules/evaluation/benchmark.metrics";

/** Fictional unit-test fixtures; these are NOT expert gold annotations. */
function syntheticGold(): GoldBenchmark {
  return {
    schemaVersion: "1.0",
    datasetId: "synthetic-unit-test-only",
    corpusSnapshotId: "synthetic-corpus-v1",
    cases: [
      {
        id: "case-1",
        query: "Яка дата подання заяв?",
        split: "dev",
        annotatorIds: ["unit-reviewer-a", "unit-reviewer-b"],
        adjudicatedBy: "unit-reviewer-a",
        sources: [{
          id: "fragment-1",
          documentId: "fictional-regulation",
          documentVersion: "v1",
          text: "Подання заяв завершується 15 серпня включно.",
        }],
        claims: [
          {
            id: "claim-1", text: "Подання заяв завершується 15 серпня.",
            verdict: "supported",
            sourceId: "fragment-1",
            evidenceQuote: "Подання заяв завершується 15 серпня включно.",
          },
          {
            id: "claim-2", text: "Подання заяв завершується 20 серпня.",
            verdict: "contradicted",
            sourceId: "fragment-1",
            evidenceQuote: "Подання заяв завершується 15 серпня включно.",
          },
          { id: "claim-3", text: "Студенти отримують грант.", verdict: "unsupported" },
          { id: "claim-4", text: "Потрібне додаткове погодження.", verdict: "uncertain" },
        ],
      },
    ],
  };
}

function testValidSchema(): void {
  const gold = syntheticGold();
  assert.equal(validateGoldBenchmark(gold).cases.length, 1);
}

function testInvalidSchema(): void {
  const withChange = (change: (g: GoldBenchmark) => void): GoldBenchmark => {
    const g = syntheticGold();
    change(g);
    return g;
  };
  assert.throws(() => validateGoldBenchmark(withChange(g => {
    g.cases[0].claims[0].evidenceQuote = "Такого речення немає в джерелі.";
  })), /source evidence not found/);

  assert.throws(() => validateGoldBenchmark(withChange(g => {
    g.cases[0].claims[0].sourceId = "missing";
  })), /source evidence not found/);

  assert.throws(() => validateGoldBenchmark(withChange(g => {
    g.cases[0].claims[0].verdict = "wrong" as never;
  })), /invalid verdict/);

  assert.throws(() => validateGoldBenchmark(withChange(g => {
    g.cases[0].claims[1].id = "claim-1";
  })), /duplicate identifiers/);

  assert.throws(() => validateGoldBenchmark(withChange(g => {
    g.cases[0].split = "train" as never;
  })), /expected dev or test/);

  assert.throws(() => validateGoldBenchmark(withChange(g => {
    g.cases[0].annotatorIds = ["one"];
  })), /at least two annotators/);

  assert.throws(() => validateGoldBenchmark(withChange(g => {
    g.cases[0].sources[0].documentVersion = "";
  })), /required nonempty text/);
}

function testMetrics(): void {
  const gold = syntheticGold();
  const predictions: ClaimPrediction[] = [
    { caseId: "case-1", claimId: "claim-1", verdict: "supported" },
    { caseId: "case-1", claimId: "claim-2", verdict: "supported" },
    { caseId: "case-1", claimId: "claim-3", verdict: "unsupported" },
    { caseId: "case-1", claimId: "claim-4", verdict: "uncertain" },
  ];
  const result = scoreClaimPredictions(gold, predictions);
  assert.equal(result.totalClaims, 4);
  assert.equal(result.accuracy, 0.75);
  assert.equal(result.missedContradictions, 1);
  assert.equal(result.contradictionMissRate, 1);
  assert.equal(result.perClass.supported.precision, 0.5);
  assert.equal(result.perClass.contradicted.recall, 0);
  assert.equal(result.perClass.unsupported.f1, 1);
  assert.ok(Math.abs(result.macroF1 - (2 / 3 + 0 + 1 + 1) / 4) < 1e-10);

  assert.throws(() => scoreClaimPredictions(gold, predictions.slice(1)), /missing records/);
  assert.throws(() => scoreClaimPredictions(gold, [...predictions, predictions[0]]), /duplicate caseId\/claimId/);
  assert.throws(() => scoreClaimPredictions(gold, [
    ...predictions.slice(0, 3), { caseId: "case-1", claimId: "not-real", verdict: "uncertain" },
  ]), /unknown caseId\/claimId/);
}

testValidSchema();
testInvalidSchema();
testMetrics();
console.log("Benchmark offline checks passed (synthetic fixtures only).");
