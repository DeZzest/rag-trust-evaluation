import { generate } from "../llm/ollama.service";
import { generateEmbedding } from "../embeddings/embedding.service";
import { similaritySearch, SearchResult } from "../vector-db/chroma.service";

/**
 * Interface for RAG query result
 */
export interface RagQueryResult {
  answer: string;
  sources: Array<{
    documentId: string;
    text: string;
    distance: number;
    similarity: number;
    metadata?: Record<string, string | number | boolean>;
  }>;
  performance: {
    embeddingMs: number;
    retrievalMs: number;
    generationMs: number;
    totalMs: number;
  };
}

/**
 * Process a RAG query: embed, retrieve, generate answer
 * @param collectionId - ID of the vector collection
 * @param query - User query
 * @param topK - Number of documents to retrieve (default: 3)
 * @param generationModel - LLM model to use for generation (default: "llama3")
 * @returns Promise<RagQueryResult> - Query result with answer and sources
 */
export async function processRagQuery(
  collectionId: string,
  query: string,
  topK: number = 3,
  generationModel?: string
): Promise<RagQueryResult> {
  try {
    if (!collectionId || collectionId.trim().length === 0) {
      throw new Error("Collection ID cannot be empty");
    }

    if (!query || query.trim().length === 0) {
      throw new Error("Query cannot be empty");
    }

    const startTotal = Date.now();

    // 1️⃣ Generate embedding for query
    console.log("Generating embedding for query...");
    const startEmbedding = Date.now();
    const queryEmbedding = await generateEmbedding(query);
    const embeddingMs = Date.now() - startEmbedding;
    console.log(`✅ Embedding generated in ${embeddingMs}ms`);

    // 2️⃣ Retrieve similar documents from vector DB
    console.log(`Retrieving top ${topK} documents...`);
    const startRetrieval = Date.now();
    const retrievedDocs = await similaritySearch(
      collectionId,
      queryEmbedding,
      topK
    );
    const retrievalMs = Date.now() - startRetrieval;
    console.log(
      `✅ Retrieved ${retrievedDocs.length} documents in ${retrievalMs}ms`
    );

    // Check if any documents were retrieved
    if (retrievedDocs.length === 0) {
      return {
        answer:
          "I cannot find any relevant documents in the knowledge base to answer your question.",
        sources: [],
        performance: {
          embeddingMs,
          retrievalMs,
          generationMs: 0,
          totalMs: Date.now() - startTotal,
        },
      };
    }

    // 3️⃣ Format context from retrieved documents
    const context = retrievedDocs
      .map((doc, index) => `[${index + 1}] ${doc.text}`)
      .join("\n\n");

    // 4️⃣ Build prompt for LLM
    const prompt = `You are an academic assistant specialized in answering questions based on provided documents.

Your task:
- Answer the question ONLY using the provided context
- Be accurate and concise
- If the answer is not found in the context, clearly state: "I cannot find this information in the provided documents."
- Always cite the source document number [1], [2], etc. when referencing information

Context from documents:
${context}

Question:
${query}

Answer:`;

    // 5️⃣ Generate answer using LLM
    console.log("Generating answer with LLM...");
    const startGeneration = Date.now();
    const answer = await generate(prompt, generationModel);
    const generationMs = Date.now() - startGeneration;
    console.log(`✅ Answer generated in ${generationMs}ms`);

    const totalMs = Date.now() - startTotal;

    // 6️⃣ Format response
    const result: RagQueryResult = {
      answer,
      sources: retrievedDocs.map((doc) => ({
        documentId: doc.id,
        text: doc.text,
        distance: doc.distance,
        similarity: 1 - doc.distance, // Convert distance to similarity score
        metadata: doc.metadata,
      })),
      performance: {
        embeddingMs,
        retrievalMs,
        generationMs,
        totalMs,
      },
    };

    console.log(`✅ RAG query completed in ${totalMs}ms`);

    return result;
  } catch (error) {
    console.error("Error in processRagQuery:", error);
    throw error;
  }
}

/**
 * Process RAG query by collection name (helper)
 * @param collectionName - Name of the collection
 * @param query - User query
 * @param topK - Number of documents to retrieve
 * @returns Promise<RagQueryResult>
 */
export async function processRagQueryByName(
  collectionName: string,
  query: string,
  topK: number = 3
): Promise<RagQueryResult> {
  // This would require storing collection IDs separately
  // For now, the endpoint will pass the collection ID directly
  throw new Error(
    "Use processRagQuery with collectionId instead of collection name"
  );
}