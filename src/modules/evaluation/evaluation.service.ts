import { processRagQuery } from "../rag/rag.service";
import { calculateRetrievalMetrics } from "./retrieval.metrics";
import { evaluateFaithfulness } from "./faithfulness.service";
import { calculateAnswerSimilarity } from "./answer.similarity";

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
  error?: string;
  performance: {
    embeddingMs: number;
    retrievalMs: number;
    generationMs: number;
    totalMs: number;
  };
}

/**
 * Interface for batch statistics
 */
export interface BatchStatistics {
  totalQueries: number;
  successfulEvaluations: number;
  averageTrustScore: number;
  averageFaithfulness: number;
  averagePrecision: number;
  averageLatency: number;
  batchTotalMs: number;
  concurrency: number;
}

/**
 * Concurrency limiter for Ollama requests
 */
class ConcurrencyLimiter {
  private running = 0;
  private queue: Array<() => Promise<any>> = [];

  constructor(private limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running < this.limit) {
      this.running++;
      try {
        return await fn();
      } finally {
        this.running--;
        this.processQueue();
      }
    } else {
      return new Promise((resolve, reject) => {
        this.queue.push(async () => {
          try {
            resolve(await fn());
          } catch (error) {
            reject(error);
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
        fn().finally(() => {
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
  const trustScore =
    0.4 * faithfulnessScore + 0.3 * precisionAtK + 0.3 * similarity;

  return Math.max(0, Math.min(1, trustScore));
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

  console.log(`Evaluating RAG query: "${query}"`);

  // Execute RAG query
  const ragResult = await processRagQuery(
    collectionId,
    query,
    relevantDocumentIds.length > 0 ? relevantDocumentIds.length : 3,
    generationModel
  );

  // Calculate retrieval metrics
  const retrievalMetrics = calculateRetrievalMetrics(
    ragResult.sources.map((s) => ({
      id: s.documentId,
      text: s.text,
      distance: s.distance,
      metadata: s.metadata,
    })),
    relevantDocumentIds
  );

  // Build context for faithfulness evaluation
  const context = ragResult.sources
    .map((s, i) => `[${i + 1}] ${s.text}`)
    .join("\n\n");

  // 🔥 Parallel evaluation: faithfulness + similarity in parallel
  console.log("Evaluating faithfulness and similarity in parallel...");
  const [faithfulnessScore, answerSimilarity] = await Promise.all([
    evaluateFaithfulness(context, ragResult.answer, evaluationModel),
    groundTruth
      ? calculateAnswerSimilarity(ragResult.answer, groundTruth)
      : Promise.resolve(undefined),
  ]);

  console.log(`✅ Faithfulness score: ${faithfulnessScore.toFixed(2)}`);
  if (answerSimilarity) {
    console.log(`✅ Answer similarity: ${answerSimilarity.toFixed(2)}`);
  }

  // Calculate trust score
  const trustScore = calculateTrustScore({
    precisionAtK: retrievalMetrics.precisionAtK,
    faithfulnessScore,
    answerSimilarityToGroundTruth: answerSimilarity,
  });

  const totalMs = Date.now() - start;

  console.log(`✅ Trust score: ${trustScore.toFixed(2)}`);
  console.log(`✅ Evaluation completed in ${totalMs}ms`);

  return {
    query,
    ragAnswer: ragResult.answer,
    groundTruth,
    retrieval: retrievalMetrics,
    faithfulnessScore,
    answerSimilarityToGroundTruth: answerSimilarity,
    trustScore,
    evaluationModel: evaluationModel ?? "default",
    generationModel: generationModel ?? "default",
    performance: {
      embeddingMs: ragResult.performance.embeddingMs,
      retrievalMs: ragResult.performance.retrievalMs,
      generationMs: ragResult.performance.generationMs,
      totalMs,
    },
  };
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
  maxConcurrency: number = 2
): Promise<{ dataset: EvaluationQueryResult[]; statistics: BatchStatistics }> {
  const start = Date.now();
  const limiter = new ConcurrencyLimiter(maxConcurrency);

  const promises = dataset.map((item, index) =>
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
          error: error instanceof Error ? error.message : "Unknown error",
          performance: { embeddingMs: 0, retrievalMs: 0, generationMs: 0, totalMs: 0 },
        } as EvaluationQueryResult;
      }
    })
  );

  // deterministic order preserved by Promise.all
  const results = await Promise.all(promises);

  // use `results` to compute statistics (замініть попередню логіку яка працювала з push)
  const validResults = results.filter((r) => r.trustScore !== undefined);

  const averageTrustScore =
    validResults.length > 0
      ? validResults.reduce((sum, r) => sum + (r.trustScore ?? 0), 0) /
        validResults.length
      : 0;

  const averageFaithfulness =
    validResults.length > 0
      ? validResults.reduce((sum, r) => sum + (r.faithfulnessScore ?? 0), 0) /
        validResults.length
      : 0;

  const averagePrecision =
    validResults.length > 0
      ? validResults.reduce(
          (sum, r) => sum + (r.retrieval?.precisionAtK ?? 0),
          0
        ) / validResults.length
      : 0;

  const averageLatency =
    validResults.length > 0
      ? validResults.reduce((sum, r) => sum + (r.performance?.totalMs ?? 0), 0) /
        validResults.length
      : 0;

  const batchTotalMs = Date.now() - start;

  console.log(`\n✅ Batch evaluation completed in ${batchTotalMs}ms`);
  console.log(`Average Trust Score: ${averageTrustScore.toFixed(2)}`);
  console.log(`Average Faithfulness: ${averageFaithfulness.toFixed(2)}`);
  console.log(`Average Precision: ${averagePrecision.toFixed(2)}`);
  console.log(`Average Per-Query Latency: ${averageLatency.toFixed(0)}ms`);

  const statistics: BatchStatistics = {
    totalQueries: dataset.length,
    successfulEvaluations: validResults.length,
    averageTrustScore,
    averageFaithfulness,
    averagePrecision,
    averageLatency,
    batchTotalMs,
    concurrency: maxConcurrency,
  };

  return { dataset: results, statistics };
}

/**
 * Evaluate batch with multiple models for benchmarking
 */
export async function evaluateRagQueryBatchMultiModel(
  collectionId: string,
  dataset: Array<{
    query: string;
    relevantDocumentIds: string[];
    groundTruth?: string;
  }>,
  models: string[] = ["mistral", "llama3.2:1b"],
  maxConcurrency: number = 2
): Promise<{
  modelResults: Record<string, { dataset: EvaluationQueryResult[]; statistics: BatchStatistics }>;
  leaderboard: Array<{
    model: string;
    avgTrustScore: number;
    avgFaithfulness: number;
    avgPrecision: number;
    avgLatency: number;
  }>;
  totalBatchMs: number;
}> {
  const startBatch = Date.now();

  console.log(
    `Starting multi-model batch evaluation with ${dataset.length} queries and ${models.length} models...`
  );

  const modelResults: Record<string, { dataset: EvaluationQueryResult[]; statistics: BatchStatistics }> = {};

  for (const generationModel of models) {
    console.log(`Evaluating generation model: ${generationModel}`);
    const result = await evaluateRagQueryBatch(
      collectionId,
      dataset,
      /* evaluationModel */ process.env.EVAL_MODEL ?? "mistral",
      /* generationModel */ generationModel,
      maxConcurrency
    );
    modelResults[generationModel] = result;
  }

  const totalBatchMs = Date.now() - startBatch;

  // Create leaderboard
  const leaderboard = models
    .map((model) => ({
      model,
      avgTrustScore: modelResults[model].statistics.averageTrustScore,
      avgFaithfulness: modelResults[model].statistics.averageFaithfulness,
      avgPrecision: modelResults[model].statistics.averagePrecision,
      avgLatency: modelResults[model].statistics.averageLatency,
    }))
    .sort((a, b) => b.avgTrustScore - a.avgTrustScore);

  return {
    modelResults,
    leaderboard,
    totalBatchMs,
  };
}
