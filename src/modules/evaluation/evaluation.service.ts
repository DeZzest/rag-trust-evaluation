import { processRagQuery } from "../rag/rag.service";
import { calculateRetrievalMetrics } from "./retrieval.metrics";
import { evaluateFaithfulness } from "./faithfulness.service";
import { calculateAnswerSimilarity } from "./answer.similarity";

export async function evaluateRagQuery(
  collectionId: string,
  query: string,
  relevantDocumentIds: string[],
  groundTruth?: string
) {
  const start = Date.now();

  const ragResult = await processRagQuery(
    collectionId,
    query,
    relevantDocumentIds.length
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

  const context = ragResult.sources
    .map((s, i) => `[${i + 1}] ${s.text}`)
    .join("\n");

  const faithfulnessScore = await evaluateFaithfulness(
    context,
    ragResult.answer
  );

  let answerSimilarity;
  if (groundTruth) {
    answerSimilarity = await calculateAnswerSimilarity(
      ragResult.answer,
      groundTruth
    );
  }

  return {
    query,
    ragAnswer: ragResult.answer,
    retrieval: retrievalMetrics,
    faithfulnessScore,
    answerSimilarityToGroundTruth: answerSimilarity,
    performance: {
      totalMs: Date.now() - start,
    },
  };
}
