import { processRagQuery } from "../rag/rag.service";
import { calculateRetrievalMetrics } from "./retrieval.metrics";
import { evaluateFaithfulness } from "./faithfulness.service";
import { calculateAnswerSimilarity } from "./answer.similarity";

/**
 * Calculate trust score based on weighted metrics
 * Weights:
 *   - Faithfulness: 40% (most important)
 *   - Precision@K: 30% (retrieval quality)
 *   - Answer Similarity: 30% (alignment with ground truth)
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
  // Use 0.5 as neutral default if ground truth not provided
  const similarity = answerSimilarityToGroundTruth ?? 0.5;

  const trustScore =
    0.4 * faithfulnessScore + 0.3 * precisionAtK + 0.3 * similarity;

  // Ensure score is within valid range
  return Math.max(0, Math.min(1, trustScore));
}

/**
 * Evaluate a single RAG query with comprehensive metrics
 */
export async function evaluateRagQuery(
  collectionId: string,
  query: string,
  relevantDocumentIds: string[],
  groundTruth?: string
) {
  const start = Date.now();

  console.log(`Evaluating RAG query: "${query}"`);

  // Execute RAG query
  const ragResult = await processRagQuery(
    collectionId,
    query,
    relevantDocumentIds.length > 0 ? relevantDocumentIds.length : 3
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

  // Evaluate faithfulness
  console.log("Evaluating faithfulness...");
  const faithfulnessScore = await evaluateFaithfulness(
    context,
    ragResult.answer
  );
  console.log(`✅ Faithfulness score: ${faithfulnessScore.toFixed(2)}`);

  // Calculate answer similarity if ground truth provided
  let answerSimilarity: number | undefined;
  if (groundTruth) {
    console.log("Calculating answer similarity to ground truth...");
    answerSimilarity = await calculateAnswerSimilarity(
      ragResult.answer,
      groundTruth
    );
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
    performance: {
      embeddingMs: ragResult.performance.embeddingMs,
      retrievalMs: ragResult.performance.retrievalMs,
      generationMs: ragResult.performance.generationMs,
      totalMs,
    },
  };
}

/**
 * Evaluate multiple RAG queries in batch
 */
export async function evaluateRagQueryBatch(
  collectionId: string,
  dataset: Array<{
    query: string;
    relevantDocumentIds: string[];
    groundTruth?: string;
  }>
) {
  const startBatch = Date.now();

  console.log(`Starting batch evaluation with ${dataset.length} items...`);

  const results = [];

  for (let i = 0; i < dataset.length; i++) {
    const item = dataset[i];

    console.log(`\n[${i + 1}/${dataset.length}] Processing: "${item.query}"`);

    try {
      const result = await evaluateRagQuery(
        collectionId,
        item.query,
        item.relevantDocumentIds,
        item.groundTruth
      );

      results.push(result);
    } catch (error) {
      console.error(`Error evaluating query ${i + 1}:`, error);

      results.push({
        query: item.query,
        ragAnswer: null,
        groundTruth: item.groundTruth,
        retrieval: { precisionAtK: 0, recallAtK: 0, averageSimilarity: 0 },
        faithfulnessScore: 0,
        answerSimilarityToGroundTruth: undefined,
        trustScore: 0,
        error: error instanceof Error ? error.message : "Unknown error",
        performance: { embeddingMs: 0, retrievalMs: 0, generationMs: 0, totalMs: 0 },
      });
    }
  }

  // Calculate aggregate statistics
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

  const batchTotalMs = Date.now() - startBatch;

  console.log(`\n✅ Batch evaluation completed in ${batchTotalMs}ms`);
  console.log(`Average Trust Score: ${averageTrustScore.toFixed(2)}`);
  console.log(`Average Faithfulness: ${averageFaithfulness.toFixed(2)}`);
  console.log(`Average Precision: ${averagePrecision.toFixed(2)}`);

  return {
    dataset: results,
    statistics: {
      totalQueries: dataset.length,
      successfulEvaluations: validResults.length,
      averageTrustScore,
      averageFaithfulness,
      averagePrecision,
      batchTotalMs,
    },
  };
}
