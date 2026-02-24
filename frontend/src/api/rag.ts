import axios from "axios";
import {
  CitationValidation,
  PerformanceMetrics,
  RagContextTraceItem,
  RagQueryPayload,
  RagQueryResponse,
  RagSource,
  SourceMetadata,
  TrustBreakdown,
  TrustMode,
  TrustResult,
} from "../types/rag.types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const DEFAULT_COLLECTION_ID =
  import.meta.env.VITE_DEFAULT_COLLECTION_ID?.trim() ??
  import.meta.env.VITE_DEFAULT_COLLECTION?.trim() ??
  "lute_university_docs";

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 120_000,
  headers: {
    "Content-Type": "application/json",
  },
});

function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toOptionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter((item) => item.length > 0);
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => toNumber(item, Number.NaN))
    .filter((item) => Number.isFinite(item));
}

function normalizeMetadata(value: unknown): SourceMetadata | undefined {
  const obj = asObject(value);
  if (!obj) return undefined;

  const normalized: SourceMetadata = {};
  for (const [key, raw] of Object.entries(obj)) {
    if (
      typeof raw === "string" ||
      typeof raw === "number" ||
      typeof raw === "boolean"
    ) {
      normalized[key] = raw;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeSource(rawSource: unknown, index: number): RagSource {
  const source = asObject(rawSource) ?? {};
  const metadata = normalizeMetadata(source.metadata);

  const distance = toNumber(source.distance, 1);
  const similarity = clamp01(toNumber(source.similarity, 1 - distance));
  const confidence = clamp01(toNumber(source.confidence, similarity));

  const section =
    typeof source.section === "string"
      ? source.section
      : typeof metadata?.section === "string"
        ? metadata.section
        : undefined;

  const subsection =
    typeof source.subsection === "string"
      ? source.subsection
      : typeof metadata?.subsection === "string"
        ? metadata.subsection
        : undefined;

  const documentYear =
    toOptionalNumber(source.documentYear) ??
    toOptionalNumber(source.year) ??
    toOptionalNumber(metadata?.year);

  return {
    documentId: String(source.documentId ?? source.id ?? `source-${index + 1}`),
    text: String(source.text ?? ""),
    distance,
    similarity,
    confidence,
    documentYear,
    section,
    subsection,
    metadata,
  };
}

function normalizeCitationValidation(rawValidation: unknown): CitationValidation {
  const validation = asObject(rawValidation) ?? {};
  return {
    citations: toNumberArray(validation.citations),
    uniqueCitations: toNumberArray(validation.uniqueCitations),
    invalidCitations: toNumberArray(validation.invalidCitations),
    hasCitations: Boolean(validation.hasCitations),
    factualSentenceCount: toNumber(validation.factualSentenceCount, 0),
    citedSentenceCount: toNumber(validation.citedSentenceCount, 0),
    missingCitationSentenceCount: toNumber(validation.missingCitationSentenceCount, 0),
    coverage: clamp01(toNumber(validation.coverage, 0)),
    citationValidity: clamp01(toNumber(validation.citationValidity, 0)),
    isValid: Boolean(validation.isValid),
    retryCount: toNumber(validation.retryCount, 0),
    issues: toStringArray(validation.issues),
  };
}

function normalizeContextTrace(rawTrace: unknown): RagContextTraceItem[] {
  if (!Array.isArray(rawTrace)) return [];

  return rawTrace.map((item, index) => {
    const trace = asObject(item) ?? {};
    return {
      citationNumber: toNumber(trace.citationNumber, index + 1),
      sourceId: String(trace.sourceId ?? trace.documentId ?? `source-${index + 1}`),
      documentId: String(trace.documentId ?? trace.sourceId ?? "unknown"),
      documentYear: toOptionalNumber(trace.documentYear),
      section: typeof trace.section === "string" ? trace.section : undefined,
      subsection: typeof trace.subsection === "string" ? trace.subsection : undefined,
      confidence: clamp01(toNumber(trace.confidence, 0)),
      label: String(trace.label ?? ""),
    };
  });
}

function normalizeBreakdown(rawBreakdown: unknown): TrustBreakdown | undefined {
  const breakdown = asObject(rawBreakdown);
  if (!breakdown) return undefined;

  const mode = breakdown.mode === "full" ? "full" : "lightweight";
  return {
    mode,
    score: clamp01(toNumber(breakdown.score, 0)),
    retrievalQuality: toOptionalNumber(breakdown.retrievalQuality),
    citationCoverage: clamp01(toNumber(breakdown.citationCoverage, 0)),
    citationValidity: clamp01(toNumber(breakdown.citationValidity, 0)),
    faithfulnessScore: toOptionalNumber(breakdown.faithfulnessScore),
    precisionAtK: toOptionalNumber(breakdown.precisionAtK),
    answerSimilarityToGroundTruth: toOptionalNumber(
      breakdown.answerSimilarityToGroundTruth
    ),
    baseScore: toOptionalNumber(breakdown.baseScore),
    citationScore: toOptionalNumber(breakdown.citationScore),
    semanticCompensationApplied:
      typeof breakdown.semanticCompensationApplied === "boolean"
        ? breakdown.semanticCompensationApplied
        : undefined,
    cappedByCitationPolicy: Boolean(breakdown.cappedByCitationPolicy),
    capValue: toOptionalNumber(breakdown.capValue),
  };
}

function normalizeTrust(rawTrust: unknown, fallbackScore: number): TrustResult {
  const trust = asObject(rawTrust) ?? {};
  const mode: TrustMode = trust.mode === "full" ? "full" : "lightweight";
  return {
    score: clamp01(toNumber(trust.score, fallbackScore)),
    mode,
    breakdown: normalizeBreakdown(trust.breakdown),
    faithfulnessScore: toOptionalNumber(trust.faithfulnessScore),
  };
}

function normalizePerformance(rawPerformance: unknown): PerformanceMetrics {
  const perf = asObject(rawPerformance) ?? {};
  return {
    embeddingMs: Math.max(0, toNumber(perf.embeddingMs, 0)),
    retrievalMs: Math.max(0, toNumber(perf.retrievalMs, 0)),
    generationMs: Math.max(0, toNumber(perf.generationMs, 0)),
    totalMs: Math.max(0, toNumber(perf.totalMs, 0)),
  };
}

function normalizeQueryResponse(rawData: unknown, collectionId: string): RagQueryResponse {
  const data = asObject(rawData);
  if (!data) {
    throw new Error("Unexpected server response.");
  }

  if (data.success === false) {
    const explicitError =
      typeof data.error === "string" && data.error.trim().length > 0
        ? data.error
        : "Backend returned an error.";
    throw new Error(explicitError);
  }

  const rawSources = Array.isArray(data.retrieved)
    ? data.retrieved
    : Array.isArray(data.sources)
      ? data.sources
      : [];
  const retrieved = rawSources.map(normalizeSource);

  const fallbackTrustScore = clamp01(
    toNumber(
      data.trustScore ?? asObject(data.metrics)?.trustScore ?? asObject(data.trust)?.score,
      0
    )
  );

  const normalizedTrust = normalizeTrust(data.trust, fallbackTrustScore);
  const citationValidation = normalizeCitationValidation(data.citationValidation);

  return {
    answer: String(data.answer ?? ""),
    citations: toNumberArray(data.citations),
    collectionId: String(data.collectionId ?? collectionId),
    retrieved,
    contextTrace: normalizeContextTrace(data.contextTrace),
    citationValidation,
    trust: normalizedTrust,
    performance: normalizePerformance(data.performance),
    raw: rawData,
  };
}

function normalizeError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    if (typeof data === "string" && data.trim().length > 0) {
      return data;
    }
    const payload = asObject(data);
    if (payload) {
      if (typeof payload.error === "string" && payload.error.trim().length > 0) {
        return payload.error;
      }
      if (typeof payload.message === "string" && payload.message.trim().length > 0) {
        return payload.message;
      }
    }
    if (error.code === "ECONNABORTED") {
      return "Request timeout. The model may be cold-starting.";
    }
    if (error.response?.status) {
      return `Request failed with status ${error.response.status}.`;
    }
  }

  if (error instanceof Error) return error.message;
  return "Request failed.";
}

export function getDefaultCollectionId(): string {
  return DEFAULT_COLLECTION_ID;
}

export function getCollectionSuggestions(): string[] {
  const configured = (import.meta.env.VITE_COLLECTION_IDS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const list = [...configured, DEFAULT_COLLECTION_ID];
  return Array.from(new Set(list.filter((item) => item.length > 0)));
}

export function toPercent(value: number): string {
  return `${(clamp01(value) * 100).toFixed(1)}%`;
}

export function getStrictTrustScore(score: number, coverage: number, validity: number): number {
  return clamp01(Math.min(score, coverage, validity));
}

export async function queryRag(payload: RagQueryPayload): Promise<RagQueryResponse> {
  const query = payload.query.trim();
  if (!query) {
    throw new Error("Field 'query' cannot be empty.");
  }

  const collectionId = payload.collectionId.trim() || DEFAULT_COLLECTION_ID;
  if (!collectionId) {
    throw new Error("Field 'collectionId' is required.");
  }

  const requestBody = {
    query,
    collectionId,
    topK: payload.topK ?? 3,
    includeFaithfulness: payload.includeFaithfulness ?? false,
  };

  try {
    const response = await client.post("/rag/query", requestBody);
    return normalizeQueryResponse(response.data, collectionId);
  } catch (error) {
    throw new Error(normalizeError(error));
  }
}
