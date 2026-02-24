import {
  EvaluatePayload,
  EvaluationMetrics,
  QueryPayload,
  RAGResponse,
  SourceItem,
} from "./types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toOptionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeSource(raw: any): SourceItem {
  const metadata =
    raw && typeof raw.metadata === "object" && raw.metadata !== null
      ? (raw.metadata as Record<string, string | number | boolean>)
      : undefined;

  const section =
    metadata && typeof metadata.section === "string"
      ? metadata.section
      : undefined;
  const subsection =
    metadata && typeof metadata.subsection === "string"
      ? metadata.subsection
      : undefined;
  const year =
    metadata && metadata.year !== undefined
      ? toOptionalNumber(metadata.year)
      : undefined;

  return {
    documentId: String(raw?.documentId ?? raw?.id ?? "unknown"),
    text: String(raw?.text ?? ""),
    distance: toNumber(raw?.distance, 1),
    similarity: toNumber(raw?.similarity, 0),
    documentYear: year,
    section,
    subsection,
    metadata,
  };
}

export async function askQuestion(payload: QueryPayload): Promise<RAGResponse> {
  const body: Record<string, unknown> = {
    query: payload.query,
  };

  if (payload.collectionId && payload.collectionId.trim().length > 0) {
    body.collectionId = payload.collectionId.trim();
  }
  if (payload.topK !== undefined) {
    body.topK = payload.topK;
  }

  const response = await fetch(`${API_BASE_URL}/rag/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch response: ${response.status}`);
  }

  const data = await response.json();
  if (!data?.success) {
    throw new Error(String(data?.error ?? "Backend returned an error"));
  }

  const rawSources = Array.isArray(data.retrieved)
    ? data.retrieved
    : Array.isArray(data.sources)
      ? data.sources
      : [];
  const retrieved = rawSources.map(normalizeSource);

  const trustScore = toNumber(data.trustScore ?? data.trust?.score, 0);
  const citationCoverage = toNumber(
    data.metrics?.citationCoverage ?? data.citationValidation?.coverage,
    0
  );
  const citationValidity = toNumber(
    data.metrics?.citationValidity ?? data.citationValidation?.citationValidity,
    0
  );

  const citations = Array.isArray(data.citations)
    ? data.citations
        .map((c: unknown) => toNumber(c, NaN))
        .filter((c: number) => Number.isFinite(c))
    : [];

  return {
    answer: String(data.answer ?? ""),
    trustScore,
    metrics: {
      trustScore,
      citationCoverage,
      citationValidity,
      faithfulness: data.metrics?.faithfulness
        ? toNumber(data.metrics.faithfulness)
        : undefined,
    },
    citations,
    citationValidation: data.citationValidation
      ? {
          coverage: toNumber(data.citationValidation.coverage, 0),
          citationValidity: toNumber(
            data.citationValidation.citationValidity,
            0
          ),
          isValid: Boolean(data.citationValidation.isValid),
          retryCount: toNumber(data.citationValidation.retryCount, 0),
          issues: Array.isArray(data.citationValidation.issues)
            ? data.citationValidation.issues.map(String)
            : [],
        }
      : undefined,
    retrieved,
    raw: data,
  };
}

export async function evaluateQuestion(
  payload: EvaluatePayload
): Promise<EvaluationMetrics | null> {
  if (!payload.relevantDocumentIds.length) {
    return null;
  }

  const body: Record<string, unknown> = {
    query: payload.query,
    relevantDocumentIds: payload.relevantDocumentIds,
  };

  if (payload.collectionId && payload.collectionId.trim().length > 0) {
    body.collectionId = payload.collectionId.trim();
  }
  if (payload.groundTruth && payload.groundTruth.trim().length > 0) {
    body.groundTruth = payload.groundTruth.trim();
  }

  const response = await fetch(`${API_BASE_URL}/rag/evaluate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Failed to evaluate response: ${response.status}`);
  }

  const data = await response.json();
  if (!data?.success || !data?.result) {
    throw new Error(String(data?.error ?? "Evaluation endpoint failed"));
  }

  const result = data.result;
  return {
    retrievalPrecision: toNumber(result.retrieval?.precisionAtK, 0),
    retrievalRecall: toNumber(result.retrieval?.recallAtK, 0),
    averageSimilarity: toNumber(result.retrieval?.averageSimilarity, 0),
    faithfulness: toNumber(result.faithfulnessScore, 0),
    answerSimilarity:
      result.answerSimilarityToGroundTruth !== undefined
        ? toNumber(result.answerSimilarityToGroundTruth, 0)
        : undefined,
    trustScore: toNumber(result.trustScore, 0),
    diagnosis: String(result.diagnosis ?? "unknown"),
  };
}
