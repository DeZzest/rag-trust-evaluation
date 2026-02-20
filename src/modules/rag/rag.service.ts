import { generate } from "../llm/ollama.service";
import { generateEmbedding } from "../embeddings/embedding.service";
import {
  retrieveByEmbedding,
  RetrievalOptions,
} from "../vector/index_corpus";
import { evaluateFaithfulness } from "../evaluation/faithfulness.service";
import { buildContext, buildContextTrace } from "./context.builder";
import { extractAndValidateCitations } from "./citation.extractor";
import { calculateTrustScore } from "./trust.score";
import {
  CitationValidationResult,
  ContextTraceItem,
  RagQueryOptions,
  RetrievedChunk,
  TrustBreakdown,
} from "./types";

export interface RagQueryResult {
  answer: string;
  sources: Array<{
    documentId: string;
    text: string;
    distance: number;
    similarity: number;
    metadata?: Record<string, string | number | boolean>;
  }>;
  contextTrace: ContextTraceItem[];
  citations: number[];
  citationValidation: CitationValidationResult;
  trust: {
    score: number;
    mode: "lightweight" | "full";
    breakdown: TrustBreakdown;
    faithfulnessScore?: number;
  };
  performance: {
    embeddingMs: number;
    retrievalMs: number;
    generationMs: number;
    totalMs: number;
  };
}

function normalizeOptions(
  topKOrOptions?: number | RagQueryOptions,
  generationModel?: string
): Required<Pick<RagQueryOptions, "topK">> & RagQueryOptions {
  if (typeof topKOrOptions === "number") {
    const safeTopK = topKOrOptions > 0 ? topKOrOptions : 3;
    return {
      topK: safeTopK,
      generationModel,
    };
  }

  if (topKOrOptions && typeof topKOrOptions === "object") {
    const safeTopK =
      typeof topKOrOptions.topK === "number" && topKOrOptions.topK > 0
        ? topKOrOptions.topK
        : 3;
    return {
      ...topKOrOptions,
      topK: safeTopK,
    };
  }

  return {
    topK: 3,
    generationModel,
  };
}

function buildPrompt(
  query: string,
  context: string,
  contextTrace: ContextTraceItem[]
): string {
  const citationMap = contextTrace
    .map((item) => `[${item.citationNumber}] ${item.label}`)
    .join("\n");

  return `You are an academic assistant specialized in answering questions from provided sources.

Rules:
- Use ONLY the provided context.
- Every factual sentence MUST include at least one numeric citation like [1].
- Use only citation indices listed in the source map.
- Do not use citations outside the valid range.
- If the context does not contain the answer, reply exactly: "I cannot find this information in the provided documents."

Source map:
${citationMap}

Context:
${context}

Question:
${query}

Answer:`;
}

function buildRetryPrompt(
  basePrompt: string,
  previousAnswer: string,
  validation: CitationValidationResult,
  sourceCount: number
): string {
  const invalidRefs =
    validation.invalidCitations.length > 0
      ? `invalid refs: ${validation.invalidCitations.join(", ")}`
      : "invalid refs: none";

  return `${basePrompt}

Your previous answer failed citation validation.
Feedback:
- ${invalidRefs}
- missing citations: ${!validation.hasCitations}
- citation coverage: ${validation.coverage.toFixed(2)} (required >= 0.80)
- every factual sentence must contain [n], where n is between 1 and ${sourceCount}

Previous answer:
${previousAnswer}

Rewrite the answer and fix citation format and coverage.
Answer:`;
}

function toRagSources(retrievedDocs: RetrievedChunk[]): RagQueryResult["sources"] {
  return retrievedDocs.map((doc) => ({
    documentId: doc.id,
    text: doc.text,
    distance: doc.distance,
    similarity: 1 - doc.distance,
    metadata: doc.metadata,
  }));
}

function emptyCitationValidation(issue: string): CitationValidationResult {
  return {
    citations: [],
    uniqueCitations: [],
    invalidCitations: [],
    hasCitations: false,
    factualSentenceCount: 0,
    citedSentenceCount: 0,
    missingCitationSentenceCount: 0,
    coverage: 0,
    citationValidity: 0,
    isValid: false,
    retryCount: 0,
    issues: [issue],
  };
}

export async function processRagQuery(
  collectionId: string,
  query: string,
  topK?: number,
  generationModel?: string
): Promise<RagQueryResult>;
export async function processRagQuery(
  collectionId: string,
  query: string,
  options?: RagQueryOptions
): Promise<RagQueryResult>;
export async function processRagQuery(
  collectionId: string,
  query: string,
  topKOrOptions?: number | RagQueryOptions,
  generationModel?: string
): Promise<RagQueryResult> {
  try {
    if (!collectionId || collectionId.trim().length === 0) {
      throw new Error("Collection ID cannot be empty");
    }

    if (!query || query.trim().length === 0) {
      throw new Error("Query cannot be empty");
    }

    const options = normalizeOptions(topKOrOptions, generationModel);
    const retrievalOptions: RetrievalOptions = {
      topK: options.topK,
      year: options.year,
      documentType: options.documentType,
    };

    const startTotal = Date.now();

    console.log("Generating embedding for query...");
    const startEmbedding = Date.now();
    const queryEmbedding = await generateEmbedding(query);
    const embeddingMs = Date.now() - startEmbedding;
    console.log(`Embedding generated in ${embeddingMs}ms`);

    console.log(`Retrieving top ${options.topK} documents...`);
    const startRetrieval = Date.now();
    const retrievedDocs = await retrieveByEmbedding(
      collectionId,
      queryEmbedding,
      retrievalOptions
    );
    const retrievalMs = Date.now() - startRetrieval;
    console.log(
      `Retrieved ${retrievedDocs.length} documents in ${retrievalMs}ms`
    );

    if (retrievedDocs.length === 0) {
      const zeroTrust = calculateTrustScore({
        mode: "lightweight",
        retrievalQuality: 0,
        citationCoverage: 0,
        citationValidity: 0,
        citationInvalidAfterRetry: true,
      });

      return {
        answer:
          "I cannot find any relevant documents in the knowledge base to answer your question.",
        sources: [],
        contextTrace: [],
        citations: [],
        citationValidation: emptyCitationValidation("no_sources_retrieved"),
        trust: {
          score: 0,
          mode: "lightweight",
          breakdown: {
            ...zeroTrust,
            score: 0,
          },
        },
        performance: {
          embeddingMs,
          retrievalMs,
          generationMs: 0,
          totalMs: Date.now() - startTotal,
        },
      };
    }

    const context = buildContext(retrievedDocs);
    const contextTrace = buildContextTrace(retrievedDocs);
    const basePrompt = buildPrompt(query, context, contextTrace);

    console.log("Generating answer with LLM...");
    const startGeneration = Date.now();
    let answer = await generate(basePrompt, options.generationModel);
    let citationValidation = extractAndValidateCitations(
      answer,
      retrievedDocs.length
    );

    if (!citationValidation.isValid) {
      const retryPrompt = buildRetryPrompt(
        basePrompt,
        answer,
        citationValidation,
        retrievedDocs.length
      );
      answer = await generate(retryPrompt, options.generationModel);
      citationValidation = extractAndValidateCitations(
        answer,
        retrievedDocs.length
      );
      citationValidation.retryCount = 1;
    }

    const generationMs = Date.now() - startGeneration;
    console.log(`Answer generated in ${generationMs}ms`);

    const retrievalQuality =
      retrievedDocs.reduce((sum, chunk) => sum + chunk.confidence, 0) /
      retrievedDocs.length;

    const trustBreakdown = calculateTrustScore({
      mode: "lightweight",
      retrievalQuality,
      citationCoverage: citationValidation.coverage,
      citationValidity: citationValidation.citationValidity,
      citationInvalidAfterRetry:
        citationValidation.retryCount > 0 && !citationValidation.isValid,
    });

    let faithfulnessScore: number | undefined;
    if (options.includeFaithfulness) {
      try {
        faithfulnessScore = await evaluateFaithfulness(
          context,
          answer,
          options.evaluationModel
        );
      } catch (error) {
        console.warn("Faithfulness evaluation failed in rag/query:", error);
      }
    }

    const totalMs = Date.now() - startTotal;

    const result: RagQueryResult = {
      answer,
      sources: toRagSources(retrievedDocs),
      contextTrace,
      citations: citationValidation.uniqueCitations,
      citationValidation,
      trust: {
        score: trustBreakdown.score,
        mode: trustBreakdown.mode,
        breakdown: trustBreakdown,
        faithfulnessScore,
      },
      performance: {
        embeddingMs,
        retrievalMs,
        generationMs,
        totalMs,
      },
    };

    console.log(`RAG query completed in ${totalMs}ms`);

    return result;
  } catch (error) {
    console.error("Error in processRagQuery:", error);
    throw error;
  }
}

export async function processRagQueryByName(
  _collectionName: string,
  _query: string,
  _topK: number = 3
): Promise<RagQueryResult> {
  throw new Error(
    "Use processRagQuery with collectionId instead of collection name"
  );
}
