export interface RetrievalMetrics {
  precisionAtK: number;
  recallAtK: number;
  averageSimilarity: number;
}

export interface EvaluationResult {
  query: string;
  ragAnswer: string;
  groundTruth?: string;

  retrieval: RetrievalMetrics;

  faithfulnessScore?: number;
  answerSimilarityToGroundTruth?: number;

  performance: {
    totalMs: number;
  };
}
