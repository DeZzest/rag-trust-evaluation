export interface RetrievedChunk {
  id: string;
  text: string;
  distance: number;
  confidence: number;
  documentId: string;
  documentYear?: number;
  documentType?: string;
  section?: string;
  subsection?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface ContextTraceItem {
  citationNumber: number;
  sourceId: string;
  documentId: string;
  documentYear?: number;
  section?: string;
  subsection?: string;
  confidence: number;
  label: string;
}

export interface CitationValidationResult {
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

export interface RagQueryOptions {
  topK?: number;
  year?: number;
  documentType?: string;
  generationModel?: string;
  includeFaithfulness?: boolean;
  evaluationModel?: string;
}

export interface TrustBreakdown {
  mode: "lightweight" | "full";
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
