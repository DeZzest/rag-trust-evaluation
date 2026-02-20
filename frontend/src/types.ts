export interface Metrics {
  trustScore: number;
  citationCoverage: number;
  citationValidity: number;
  retrievalPrecision?: number;
  retrievalRecall?: number;
  averageSimilarity?: number;
  faithfulness?: number;
  answerSimilarity?: number;
  evaluationTrustScore?: number;
  diagnosis?: string;
}

export interface SourceItem {
  documentId: string;
  text: string;
  distance: number;
  similarity: number;
  documentYear?: number;
  section?: string;
  subsection?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface CitationValidation {
  coverage: number;
  citationValidity: number;
  isValid: boolean;
  retryCount: number;
  issues: string[];
}

export interface RAGResponse {
  answer: string;
  trustScore: number;
  metrics: Metrics;
  citations: number[];
  citationValidation?: CitationValidation;
  retrieved: SourceItem[];
  raw?: unknown;
}

export interface EvaluationMetrics {
  retrievalPrecision: number;
  retrievalRecall: number;
  averageSimilarity: number;
  faithfulness: number;
  answerSimilarity?: number;
  trustScore: number;
  diagnosis: string;
}

export interface QueryPayload {
  query: string;
  collectionId?: string;
  topK?: number;
}

export interface EvaluatePayload {
  query: string;
  collectionId?: string;
  relevantDocumentIds: string[];
  groundTruth?: string;
}
