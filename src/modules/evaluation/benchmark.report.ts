import { validateGoldBenchmark, GoldBenchmark, GoldVerdict } from "./benchmark.gold";
import { BenchmarkMetrics, ClaimPrediction, scoreClaimPredictions } from "./benchmark.metrics";

export interface PredictionBatch {
  schemaVersion: "claim-predictions/1";
  datasetId: string;
  corpusSnapshotId: string;
  runId: string;
  methodId: string;
  modelId: string;
  evaluationMode: "gold_claim_classification" | "aligned_rag_claims";
  configuration: Record<string, unknown>;
  predictions: ClaimPrediction[];
}

export interface SplitScore {
  caseCount: number;
  claimCount: number;
  metrics: BenchmarkMetrics;
}

export interface BenchmarkReport {
  schemaVersion: "benchmark-report/1";
  datasetId: string;
  corpusSnapshotId: string;
  runId: string;
  methodId: string;
  modelId: string;
  evaluationMode: PredictionBatch["evaluationMode"];
  configuration: Record<string, unknown>;
  overall: SplitScore;
  dev: SplitScore | null;
  test: SplitScore | null;
  // The CLI adds hashes of the exact files used for this run.
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(label + ": required nonempty string");
  }
  return value.trim();
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

const VALID_VERDICTS: ReadonlySet<string> = new Set([
  "supported", "contradicted", "unsupported", "uncertain",
]);

/**
 * Align exactly one prediction to every gold claim and preserve split
 * separation. This is an offline scoring utility, not a claim alignment or
 * generation algorithm.
 */
export function buildBenchmarkReport(
  goldInput: unknown,
  predictionInput: unknown
): BenchmarkReport {
  const gold: GoldBenchmark = validateGoldBenchmark(goldInput);
  const raw = record(predictionInput);
  if (!raw || raw.schemaVersion !== "claim-predictions/1") {
    throw new Error("predictions: unsupported schemaVersion");
  }

  const datasetId = nonempty(raw.datasetId, "predictions.datasetId");
  const corpusSnapshotId = nonempty(raw.corpusSnapshotId, "predictions.corpusSnapshotId");
  if (datasetId !== gold.datasetId || corpusSnapshotId !== gold.corpusSnapshotId) {
    throw new Error("predictions: gold dataset or corpus snapshot mismatch");
  }
  const runId = nonempty(raw.runId, "predictions.runId");
  const methodId = nonempty(raw.methodId, "predictions.methodId");
  const modelId = nonempty(raw.modelId, "predictions.modelId");
  const evaluationMode = raw.evaluationMode;
  if (evaluationMode !== "gold_claim_classification" &&
      evaluationMode !== "aligned_rag_claims") {
    throw new Error("predictions.evaluationMode: invalid value");
  }
  const configuration = record(raw.configuration);
  if (!configuration || Object.keys(configuration).length === 0) {
    throw new Error("predictions.configuration: nonempty object required");
  }
  if (!Array.isArray(raw.predictions)) {
    throw new Error("predictions.predictions: array required");
  }
  const predictions = raw.predictions.map((entry: unknown, i: number): ClaimPrediction => {
    const p = record(entry);
    if (!p || typeof p.caseId !== "string" || !p.caseId.trim() ||
        typeof p.claimId !== "string" || !p.claimId.trim() ||
        typeof p.verdict !== "string" || !VALID_VERDICTS.has(p.verdict)) {
      throw new Error("predictions.predictions[" + i + "]: invalid prediction");
    }
    return {
      caseId: p.caseId,
      claimId: p.claimId,
      verdict: p.verdict as GoldVerdict,
    };
  });

  // Check full one-to-one alignment before dividing into splits. An absent
  // prediction must be an error, not a silently skipped test example.
  const overallMetrics = scoreClaimPredictions(gold, predictions);
  const overall: SplitScore = {
    caseCount: gold.cases.length,
    claimCount: overallMetrics.totalClaims,
    metrics: overallMetrics,
  };

  const splitScore = (split: "dev" | "test"): SplitScore | null => {
    const cases = gold.cases.filter(c => c.split === split);
    if (cases.length === 0) return null;
    const caseIds = new Set(cases.map(c => c.id));
    const splitPredictions = predictions.filter(p => caseIds.has(p.caseId));
    const subset: GoldBenchmark = { ...gold, cases };
    const metrics = scoreClaimPredictions(subset, splitPredictions);
    return { caseCount: cases.length, claimCount: metrics.totalClaims, metrics };
  };

  return {
    schemaVersion: "benchmark-report/1",
    datasetId,
    corpusSnapshotId,
    runId,
    methodId,
    modelId,
    evaluationMode,
    configuration,
    overall,
    dev: splitScore("dev"),
    test: splitScore("test"),
  };
}
