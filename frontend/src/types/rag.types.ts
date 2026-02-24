export type Primitive = string | number | boolean;
export type TrustMode = "lightweight" | "full";
export type TrustViewMode = "backend" | "strict";

export interface QueryInputValues {
  query: string;
  collectionId: string;
  topK: number;
  includeFaithfulness: boolean;
}

export interface RagQueryPayload {
  query: string;
  collectionId: string;
  topK?: number;
  includeFaithfulness?: boolean;
}

export interface SourceMetadata {
  [key: string]: Primitive;
}

export interface RagSource {
  documentId: string;
  text: string;
  distance: number;
  similarity: number;
  confidence: number;
  documentYear?: number;
  section?: string;
  subsection?: string;
  metadata?: SourceMetadata;
}

export interface RagContextTraceItem {
  citationNumber: number;
  sourceId: string;
  documentId: string;
  documentYear?: number;
  section?: string;
  subsection?: string;
  confidence: number;
  label: string;
}

export interface CitationValidation {
  citations: number[];
  uniqueCitations: number[];
  invalidCitations: number[];
  hasCitations: boolean;
  factualSentenceCount: number;
  citedSentenceCount: number;
  missingCitationSentenceCount: number;
  coverage: number;
  citationValidity: number;
  isValid: boolean;
  retryCount: number;
  issues: string[];
}

export interface TrustBreakdown {
  mode: TrustMode;
  score: number;
  retrievalQuality?: number;
  citationCoverage: number;
  citationValidity: number;
  faithfulnessScore?: number;
  precisionAtK?: number;
  answerSimilarityToGroundTruth?: number;
  baseScore?: number;
  citationScore?: number;
  semanticCompensationApplied?: boolean;
  cappedByCitationPolicy: boolean;
  capValue?: number;
}

export interface TrustResult {
  score: number;
  mode: TrustMode;
  breakdown?: TrustBreakdown;
  faithfulnessScore?: number;
}

export interface PerformanceMetrics {
  embeddingMs: number;
  retrievalMs: number;
  generationMs: number;
  totalMs: number;
}

export interface RagQueryResponse {
  answer: string;
  citations: number[];
  collectionId: string;
  retrieved: RagSource[];
  contextTrace: RagContextTraceItem[];
  citationValidation: CitationValidation;
  trust: TrustResult;
  performance: PerformanceMetrics;
  raw: unknown;
}
