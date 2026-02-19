import fs from "fs";
import path from "path";
import crypto from "crypto";
import { processRagQuery } from "../rag/rag.service";
import { calculateRetrievalMetrics } from "./retrieval.metrics";
import { evaluateFaithfulness } from "./faithfulness.service";
import { calculateAnswerSimilarity } from "./answer.similarity";

const BENCH_DIR = path.resolve(process.cwd(), "data");
const BENCH_FILE = path.join(BENCH_DIR, "benchmarks.json");

// 🔧 Safe number parsing for env variables
function safeNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// 🔧 Trust score weights from env (with validation)
const TRUST_WEIGHTS = {
  faithfulness: safeNumber(process.env.TRUST_WEIGHT_FAITH, 0.4),
  precision: safeNumber(process.env.TRUST_WEIGHT_PREC, 0.3),
  similarity: safeNumber(process.env.TRUST_WEIGHT_SIM, 0.3),
};

// Version for tracking evaluation logic changes
const EVALUATION_VERSION = "1.0.0";

function ensureBenchFile() {
  if (!fs.existsSync(BENCH_DIR)) fs.mkdirSync(BENCH_DIR, { recursive: true });
  if (!fs.existsSync(BENCH_FILE)) fs.writeFileSync(BENCH_FILE, "[]", "utf8");
}

// 📊 Calculate percentile (p95, p99, etc) — mathematical precision fix
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.floor(p * (sorted.length - 1));
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

// 🔒 Validate record before persistence
function validateBenchmarkRecord(record: any): boolean {
  // Must have valid string fields
  if (typeof record.generationModel !== "string") {
    console.warn("Invalid generationModel type:", typeof record.generationModel);
    return false;
  }

  if (typeof record.evaluationModel !== "string") {
    console.warn("Invalid evaluationModel type:", typeof record.evaluationModel);
    return false;
  }

  // Don't persist empty or zero records
  if (!record.statistics.datasetSize || record.statistics.datasetSize === 0) {
    console.warn("Skipping empty dataset record");
    return false;
  }

  if (record.statistics.averageTrustScore === 0 && record.statistics.totalQueries > 0) {
    console.warn("Skipping zero trust score record (likely error)");
    return false;
  }

  if (record.statistics.batchTotalMs === 0) {
    console.warn("Skipping zero latency record (likely error)");
    return false;
  }

  return true;
}

async function persistBenchmarkRecord(record: any) {
  // 🔒 Validate before persistence
  if (!validateBenchmarkRecord(record)) {
    console.warn("Record validation failed, skipping persistence");
    return;
  }

  try {
    ensureBenchFile();
    const content = await fs.promises.readFile(BENCH_FILE, "utf8");
    const arr = JSON.parse(content || "[]");
    arr.push(record);
    await fs.promises.writeFile(BENCH_FILE, JSON.stringify(arr, null, 2), "utf8");
    console.log(`✅ Benchmark record persisted (ID: ${record.benchmarkId})`);
  } catch (err) {
    console.warn("Failed to persist benchmark record:", err);
  }
}

function datasetHash(dataset: any) {
  const str = JSON.stringify(dataset);
  return crypto.createHash("sha256").update(str).digest("hex");
}

/**
 * Interface for evaluation result
 */
export interface EvaluationQueryResult {
  query: string;
  ragAnswer: string | null;
  groundTruth?: string;
  retrieval: {
    precisionAtK: number;
    recallAtK: number;
    averageSimilarity: number;
  };
  faithfulnessScore: number;
  answerSimilarityToGroundTruth?: number;
  trustScore: number;
  evaluationModel: string;
  generationModel: string;
  diagnosis: string;
  coldStart: boolean;
  error?: string;
  performance: {
    embeddingMs: number;
    retrievalMs: number;
    generationMs: number;
    evaluationMs: number;
    faithfulnessMs: number;
    similarityMs: number;
    totalMs: number;
  };
}

/**
 * Interface for batch statistics
 */
export interface BatchStatistics {
  totalQueries: number;
  successfulEvaluations: number;
  datasetSize: number;
  averageTrustScore: number;
  averageFaithfulness: number;
  averagePrecision: number;
  averageGenerationLatency: number;
  averageEvaluationLatency: number;
  averageSimilarityLatency: number;
  p95GenerationMs: number;
  p95EvaluationMs: number;
  batchTotalMs: number;
  concurrency: number;
  trustWeights: typeof TRUST_WEIGHTS;
  evaluationVersion: string;
}

/**
 * Concurrency limiter for Ollama requests
 */
class ConcurrencyLimiter {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running < this.limit) {
      this.running++;
      try {
        const res = await fn();
        return res;
      } finally {
        this.running--;
        this.processQueue();
      }
    } else {
      return new Promise<T>((resolve, reject) => {
        this.queue.push(async () => {
          try {
            const r = await fn();
            resolve(r);
          } catch (e) {
            reject(e);
          }
        });
      });
    }
  }

  private processQueue() {
    if (this.queue.length > 0 && this.running < this.limit) {
      const fn = this.queue.shift();
      if (fn) {
        this.running++;
        Promise.resolve()
          .then(fn)
          .finally(() => {
            this.running--;
            this.processQueue();
          });
      }
    }
  }
}

/**
 * Calculate trust score based on weighted metrics
 */
function calculateTrustScore({
  precisionAtK,
  faithfulnessScore,
  answerSimilarityToGroundTruth,
}: {
  precisionAtK: number;
  faithfulnessScore: number;
  answerSimilarityToGroundTruth?: number;
}): number {
  const similarity = answerSimilarityToGroundTruth ?? 0.5;

  // 🔧 Use configurable weights
  const trustScore =
    TRUST_WEIGHTS.faithfulness * faithfulnessScore +
    TRUST_WEIGHTS.precision * precisionAtK +
    TRUST_WEIGHTS.similarity * similarity;

  return Math.max(0, Math.min(1, trustScore));
}

/** Diagnosis engine */
function diagnose(r: EvaluationQueryResult): string {
  if (r.retrieval.precisionAtK < 0.5) return "retrieval_issue";
  if (r.faithfulnessScore < 0.5) return "hallucination_issue";
  if ((r.answerSimilarityToGroundTruth ?? 0) < 0.5) return "answer_quality_issue";
  return "healthy";
}

/**
 * Evaluate a single RAG query with comprehensive metrics
 */
export async function evaluateRagQuery(
  collectionId: string,
  query: string,
  relevantDocumentIds: string[],
  groundTruth?: string,
  generationModel?: string,
  evaluationModel?: string
): Promise<EvaluationQueryResult> {
  const start = Date.now();

  // 1) Run RAG query (generationModel controls generator)
  const ragResult = await processRagQuery(
    collectionId,
    query,
    relevantDocumentIds.length > 0 ? relevantDocumentIds.length : 3,
    generationModel
  );

  const retrievalMetrics = calculateRetrievalMetrics(
    ragResult.sources.map((s) => ({
      id: s.documentId,
      text: s.text,
      distance: s.distance,
      metadata: s.metadata,
    })),
    relevantDocumentIds
  );

  const context = ragResult.sources.map((s, i) => `[${i + 1}] ${s.text}`).join("\n\n");

  // 2) Parallel evaluation with timings for faithfulness and similarity
  const evalStart = Date.now();

  let faithfulnessMs = 0;
  let similarityMs = 0;

  const faithPromise = (async () => {
    const s = Date.now();
    const v = await evaluateFaithfulness(context, ragResult.answer, evaluationModel);
    faithfulnessMs = Date.now() - s;
    return v;
  })();

  const simPromise = (async () => {
    if (!groundTruth) return undefined;
    const s = Date.now();
    const v = await calculateAnswerSimilarity(ragResult.answer, groundTruth);
    similarityMs = Date.now() - s;
    return v;
  })();

  const [faithfulnessScore, answerSimilarity] = await Promise.all([faithPromise, simPromise]);

  const evaluationMs = Date.now() - evalStart;

  // 🔒 Protect against NaN similarity
  let safeSimilarity = answerSimilarity ?? 0.5;
  if (!Number.isFinite(safeSimilarity)) safeSimilarity = 0.5;

  // 3) Trust score + diagnosis
  const trustScore = calculateTrustScore({
    precisionAtK: retrievalMetrics.precisionAtK,
    faithfulnessScore,
    answerSimilarityToGroundTruth: safeSimilarity,
  });

  const totalMs = Date.now() - start;

  // 🔥 Cold start detection (Ollama warm-up)
  const coldStart = evaluationMs > 30000;

  const result: EvaluationQueryResult = {
    query,
    ragAnswer: ragResult.answer,
    groundTruth,
    retrieval: retrievalMetrics,
    faithfulnessScore,
    answerSimilarityToGroundTruth: safeSimilarity,
    trustScore,
    evaluationModel: evaluationModel ?? "default",
    generationModel: generationModel ?? "default",
    diagnosis: "unknown",
    coldStart,
    performance: {
      embeddingMs: ragResult.performance.embeddingMs,
      retrievalMs: ragResult.performance.retrievalMs,
      generationMs: ragResult.performance.generationMs,
      evaluationMs,
      faithfulnessMs,
      similarityMs,
      totalMs,
    },
  };

  result.diagnosis = diagnose(result);

  return result;
}

/**
 * Evaluate multiple RAG queries in batch with concurrency control
 */
export async function evaluateRagQueryBatch(
  collectionId: string,
  dataset: Array<{
    query: string;
    relevantDocumentIds: string[];
    groundTruth?: string;
  }>,
  evaluationModel?: string,
  generationModel?: string,
  maxConcurrency: number = 2,
  parentBenchmarkId?: string
): Promise<{ dataset: EvaluationQueryResult[]; statistics: BatchStatistics }> {
  const startBatch = Date.now();

  const limiter = new ConcurrencyLimiter(maxConcurrency);

  const promises = dataset.map((item) =>
    limiter.run(async () => {
      try {
        return await evaluateRagQuery(
          collectionId,
          item.query,
          item.relevantDocumentIds,
          item.groundTruth,
          generationModel,
          evaluationModel
        );
      } catch (error) {
        return {
          query: item.query,
          ragAnswer: null,
          groundTruth: item.groundTruth,
          retrieval: { precisionAtK: 0, recallAtK: 0, averageSimilarity: 0 },
          faithfulnessScore: 0,
          answerSimilarityToGroundTruth: undefined,
          trustScore: 0,
          evaluationModel: evaluationModel ?? "default",
          generationModel: generationModel ?? "default",
          diagnosis: "error",
          coldStart: false,
          error: error instanceof Error ? error.message : "Unknown error",
          performance: {
            embeddingMs: 0,
            retrievalMs: 0,
            generationMs: 0,
            evaluationMs: 0,
            faithfulnessMs: 0,
            similarityMs: 0,
            totalMs: 0,
          },
        } as EvaluationQueryResult;
      }
    })
  );

  // deterministic order preserved
  const results = await Promise.all(promises);

  // aggregates
  const validResults = results.filter((r) => r.trustScore !== undefined && !r.error);

  const averageTrustScore =
    validResults.length > 0
      ? validResults.reduce((sum, r) => sum + (r.trustScore ?? 0), 0) / validResults.length
      : 0;

  const averageFaithfulness =
    validResults.length > 0
      ? validResults.reduce((sum, r) => sum + (r.faithfulnessScore ?? 0), 0) / validResults.length
      : 0;

  const averagePrecision =
    validResults.length > 0
      ? validResults.reduce((sum, r) => sum + (r.retrieval?.precisionAtK ?? 0), 0) / validResults.length
      : 0;

  const generationLatencies = validResults.map((r) => r.performance.generationMs);
  const evaluationLatencies = validResults.map((r) => r.performance.evaluationMs);
  const similarityLatencies = validResults.map((r) => r.performance.similarityMs);

  const averageGenerationLatency =
    validResults.length > 0
      ? validResults.reduce((sum, r) => sum + (r.performance.generationMs ?? 0), 0) /
        validResults.length
      : 0;

  const averageEvaluationLatency =
    validResults.length > 0
      ? validResults.reduce((sum, r) => sum + (r.performance.evaluationMs ?? 0), 0) /
        validResults.length
      : 0;

  const averageSimilarityLatency =
    validResults.length > 0
      ? validResults.reduce((sum, r) => sum + (r.performance.similarityMs ?? 0), 0) /
        validResults.length
      : 0;

  // 📊 P95 latencies
  const p95GenerationMs = percentile(generationLatencies, 0.95);
  const p95EvaluationMs = percentile(evaluationLatencies, 0.95);

  const batchTotalMs = Date.now() - startBatch;

  const statistics: BatchStatistics = {
    totalQueries: dataset.length,
    successfulEvaluations: validResults.length,
    datasetSize: dataset.length,
    averageTrustScore,
    averageFaithfulness,
    averagePrecision,
    averageGenerationLatency,
    averageEvaluationLatency,
    averageSimilarityLatency,
    p95GenerationMs,
    p95EvaluationMs,
    batchTotalMs,
    concurrency: maxConcurrency,
    trustWeights: TRUST_WEIGHTS,
    evaluationVersion: EVALUATION_VERSION,
  };

  // persist a record for this run
  const record = {
    benchmarkId: parentBenchmarkId ?? crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    datasetHash: datasetHash(dataset),
    generationModel: generationModel ?? "default",
    evaluationModel: evaluationModel ?? "default",
    statistics,
  };

  await persistBenchmarkRecord(record);

  return { dataset: results, statistics };
}

/**
 * Evaluate batch with multiple generation models for benchmarking
 */
export async function evaluateRagQueryBatchMultiModel(
  collectionId: string,
  dataset: Array<{
    query: string;
    relevantDocumentIds: string[];
    groundTruth?: string;
  }>,
  models: string[] = ["llama3.2", "mistral"],
  maxConcurrency: number = 2,
  evaluationModel: string = process.env.EVAL_MODEL ?? "mistral"
): Promise<{
  benchmarkId: string;
  modelResults: Record<string, { dataset: EvaluationQueryResult[]; statistics: BatchStatistics }>;
  leaderboard: Array<{
    model: string;
    avgTrustScore: number;
    avgFaithfulness: number;
    avgPrecision: number;
    avgGenerationLatency: number;
    avgEvaluationLatency: number;
    p95GenerationMs: number;
    adjustedScore: number;
  }>;
  totalBatchMs: number;
}> {
  const benchmarkId = crypto.randomUUID();
  const startBatch = Date.now();

  console.log(`\n📊 Starting multi-model evaluation (ID: ${benchmarkId})`);
  console.log(`📋 Models: ${models.join(", ")}`);
  console.log(`📊 Dataset size: ${dataset.length}`);

  const modelResults: Record<string, { dataset: EvaluationQueryResult[]; statistics: BatchStatistics }> = {};

  for (const generationModel of models) {
    console.log(`\n🔬 Evaluating generation model: ${generationModel}`);
    const result = await evaluateRagQueryBatch(
      collectionId,
      dataset,
      evaluationModel,
      generationModel,
      maxConcurrency,
      benchmarkId // Pass parent benchmarkId
    );
    modelResults[generationModel] = result;
  }

  const totalBatchMs = Date.now() - startBatch;

  // 🔒 Safety: use ?? 0 to prevent undefined in sort
  const leaderboard = models
    .map((model) => {
      const s = modelResults[model].statistics;
      const latencyPenalty = (s.averageGenerationLatency + s.averageEvaluationLatency) / 100000;
      const adjustedScore = (s.averageTrustScore ?? 0) - latencyPenalty;
      return {
        model,
        avgTrustScore: s.averageTrustScore ?? 0,
        avgFaithfulness: s.averageFaithfulness ?? 0,
        avgPrecision: s.averagePrecision ?? 0,
        avgGenerationLatency: s.averageGenerationLatency ?? 0,
        avgEvaluationLatency: s.averageEvaluationLatency ?? 0,
        p95GenerationMs: s.p95GenerationMs ?? 0,
        adjustedScore: adjustedScore ?? 0,
      };
    })
    .sort((a, b) => (b.adjustedScore ?? 0) - (a.adjustedScore ?? 0));

  console.log(`\n🏆 Leaderboard (Benchmark ID: ${benchmarkId}):`);
  leaderboard.forEach((item, i) => {
    console.log(
      `${i + 1}. ${item.model} - Trust: ${(item.avgTrustScore * 100).toFixed(1)}% | Adjusted: ${(item.adjustedScore * 100).toFixed(1)}%`
    );
  });

  return { benchmarkId, modelResults, leaderboard, totalBatchMs };
}

/** Helper to read persisted history */
export async function readBenchmarkHistory() {
  try {
    ensureBenchFile();
    const content = await fs.promises.readFile(BENCH_FILE, "utf8");
    return JSON.parse(content || "[]");
  } catch (err) {
    console.warn("Failed to read benchmark history:", err);
    return [];
  }
}
