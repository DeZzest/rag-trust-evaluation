import { GoldBenchmark, GoldVerdict, validateGoldBenchmark } from "./benchmark.gold";

export interface ClaimPrediction {
  caseId: string;
  claimId: string;
  verdict: GoldVerdict;
}

export interface ClassMetrics {
  precision: number;
  recall: number;
  f1: number;
  support: number;
  tp: number;
  fp: number;
  fn: number;
}

const CLASSES: GoldVerdict[] = [
  "supported", "contradicted", "unsupported", "uncertain",
];

export interface BenchmarkMetrics {
  totalClaims: number;
  accuracy: number;
  macroF1: number;
  perClass: Record<GoldVerdict, ClassMetrics>;
  confusionMatrix: Record<GoldVerdict, Record<GoldVerdict, number>>;
  // Critical false negatives: expert says contradicted, model says otherwise.
  missedContradictions: number;
  contradictionMissRate: number;
}

export function scoreClaimPredictions(
  goldInput: unknown,
  predictions: ClaimPrediction[]
): BenchmarkMetrics {
  const gold: GoldBenchmark = validateGoldBenchmark(goldInput);
  if (!Array.isArray(predictions)) throw new Error("predictions: array required");

  const expected = new Map<string, GoldVerdict>();
  for (const c of gold.cases) {
    for (const claim of c.claims) {
      expected.set(JSON.stringify([c.id, claim.id]), claim.verdict);
    }
  }

  const seen = new Map<string, GoldVerdict>();
  for (const p of predictions) {
    if (!p || typeof p.caseId !== "string" || typeof p.claimId !== "string" ||
        !CLASSES.includes(p.verdict)) {
      throw new Error("predictions: invalid record");
    }
    const key = JSON.stringify([p.caseId, p.claimId]);
    if (!expected.has(key)) throw new Error("predictions: unknown caseId/claimId");
    if (seen.has(key)) throw new Error("predictions: duplicate caseId/claimId");
    seen.set(key, p.verdict);
  }
  if (seen.size !== expected.size) {
    throw new Error(`predictions: missing records (expected ${expected.size}, got ${seen.size})`);
  }

  const confusionMatrix = {} as Record<GoldVerdict, Record<GoldVerdict, number>>;
  for (const truth of CLASSES) {
    confusionMatrix[truth] = {} as Record<GoldVerdict, number>;
    for (const predicted of CLASSES) confusionMatrix[truth][predicted] = 0;
  }
  for (const [key, truth] of expected) {
    confusionMatrix[truth][seen.get(key)!]++;
  }

  const perClass = {} as Record<GoldVerdict, ClassMetrics>;
  for (const cls of CLASSES) {
    const tp = confusionMatrix[cls][cls];
    const support = CLASSES.reduce((n, predicted) => n + confusionMatrix[cls][predicted], 0);
    const predictedPositive = CLASSES.reduce((n, truth) => n + confusionMatrix[truth][cls], 0);
    const fp = predictedPositive - tp;
    const fn = support - tp;
    const precision = predictedPositive > 0 ? tp / predictedPositive : 0;
    const recall = support > 0 ? tp / support : 0;
    const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
    perClass[cls] = { precision, recall, f1, support, tp, fp, fn };
  }

  const totalClaims = expected.size;
  const correct = CLASSES.reduce((n, cls) => n + confusionMatrix[cls][cls], 0);
  const missedContradictions = perClass.contradicted.fn;
  const contradictedCases = perClass.contradicted.support;
  return {
    totalClaims,
    accuracy: correct / totalClaims,
    macroF1: CLASSES.reduce((n, cls) => n + perClass[cls].f1, 0) / CLASSES.length,
    perClass,
    confusionMatrix,
    missedContradictions,
    contradictionMissRate: contradictedCases > 0
      ? missedContradictions / contradictedCases
      : 0,
  };
}
