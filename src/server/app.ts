import express, { Application, Request, Response } from "express";
import { generate } from "../modules/llm/ollama.service";
import { generateEmbedding } from "../modules/embeddings/embedding.service";
import {
  getOrCreateCollection,
  addDocuments,
  similaritySearch,
  ChromaDocument,
} from "../modules/vector-db/chroma.service";

console.log("App file loaded");

const app: Application = express();

app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.post("/ask", async (req: Request, res: Response) => {
  console.log("ASK ENDPOINT HIT");
  console.log("Body:", req.body);
  const question = req.body?.question;

  if (typeof question !== "string" || !question.trim()) {
    return res
      .status(400)
      .json({ error: "Field 'question' is required and must be a string." });
  }

  try {
    const answer = await generate(question);
    res.json({ answer });
  } catch (error) {
    // Basic error handling for Ollama issues
    console.error("Error while calling Ollama:", error);

    let message = "Internal server error.";
    if (error instanceof Error) {
      const lower = error.message.toLowerCase();
      if (lower.includes("ecconnrefused") || lower.includes("connect")) {
        message = "Ollama is not running or not reachable.";
      } else if (lower.includes("model") && lower.includes("not found")) {
        message = "Requested Ollama model was not found.";
      }
    }

    res.status(500).json({ error: message });
  }
});

app.post("/embed", async (req: Request, res: Response) => {
  console.log("EMBED ENDPOINT HIT");
  console.log("Body:", req.body);
  const text = req.body?.text;

  if (typeof text !== "string" || !text.trim()) {
    return res
      .status(400)
      .json({ error: "Field 'text' is required and must be a string." });
  }

  try {
    const startTime = Date.now();
    const embedding = await generateEmbedding(text);
    const duration = Date.now() - startTime;

    res.json({
      text: text.substring(0, 100), // First 100 chars for reference
      embeddingLength: embedding.length,
      first5Values: embedding.slice(0, 5),
      latencyMs: duration,
      success: true,
    });
  } catch (error) {
    console.error("Error while generating embedding:", error);

    let message = "Internal server error.";
    if (error instanceof Error) {
      const lower = error.message.toLowerCase();
      if (lower.includes("ecconnrefused") || lower.includes("connect")) {
        message = "Ollama is not running or not reachable.";
      } else if (lower.includes("model") && lower.includes("not found")) {
        message = "Requested embedding model was not found.";
      } else if (lower.includes("empty")) {
        message = "Text cannot be empty.";
      }
    }

    res.status(500).json({ error: message });
  }
});

app.post("/vector-test", async (req: Request, res: Response) => {
  console.log("VECTOR-TEST ENDPOINT HIT");

  try {
    // Step 1: Create or get collection
    const collectionName = process.env.CHROMA_COLLECTION ?? "test-documents";
    const collection = await getOrCreateCollection(collectionName);
    console.log(`Using collection: ${collection.name} (${collection.id})`);

    // Step 2: Test documents
    const testDocuments = [
      "Artificial intelligence is transforming education.",
      "Machine learning is a subset of AI.",
      "Cats are domestic animals.",
    ];

    // Step 3: Generate embeddings for test documents
    console.log("Generating embeddings for test documents...");
    const startEmbedTime = Date.now();
    const embeddings = await Promise.all(
      testDocuments.map((text) => generateEmbedding(text))
    );
    const embedDuration = Date.now() - startEmbedTime;

    // Step 4: Prepare documents for storage
    const docsToStore: ChromaDocument[] = testDocuments.map((text, index) => ({
      id: `doc-${index + 1}`,
      text,
      embedding: embeddings[index],
      metadata: {
        index: index + 1,
        category: index < 2 ? "AI" : "Animals",
      },
    }));

    // Step 5: Add documents to Chroma
    console.log("Storing documents in Chroma...");
    await addDocuments(collection.id, docsToStore);

    // Step 6: Generate embedding for query
    const query = "What is AI?";
    console.log(`Generating embedding for query: "${query}"`);
    const queryEmbedding = await generateEmbedding(query);

    // Step 7: Perform similarity search
    console.log("Performing similarity search...");
    const startSearchTime = Date.now();
    const searchResults = await similaritySearch(collection.id, queryEmbedding, 2);
    const searchDuration = Date.now() - startSearchTime;

    // Step 8: Prepare response
    res.json({
      success: true,
      collection: {
        name: collection.name,
        id: collection.id,
      },
      testDocuments: testDocuments.map((text, index) => ({
        id: `doc-${index + 1}`,
        text,
        metadata: docsToStore[index].metadata,
      })),
      query,
      searchResults: searchResults.map((result) => ({
        documentId: result.id,
        text: result.text,
        distance: result.distance,
        similarity: (1 - result.distance), // Convert distance to similarity
        metadata: result.metadata,
      })),
      performance: {
        embeddingGenerationMs: embedDuration,
        searchMs: searchDuration,
        totalMs: Date.now() - startEmbedTime,
      },
      validation: {
        expectedTopResults: ["AI-related documents"],
        actualTopResult: searchResults[0]?.metadata?.category,
        correctResults:
          searchResults.every((r) => r.metadata?.category === "AI"),
      },
    });
  } catch (error) {
    console.error("Error in vector-test endpoint:", error);

    let message = "Internal server error.";
    let statusCode = 500;

    if (error instanceof Error) {
      const lower = error.message.toLowerCase();
      if (lower.includes("ecconnrefused") || lower.includes("connect")) {
        message = "ChromaDB or Ollama is not running or not reachable.";
      } else if (lower.includes("collection")) {
        message = "Error managing collection.";
      } else if (lower.includes("embedding")) {
        message = "Error generating embeddings.";
      } else if (lower.includes("search")) {
        message = "Error performing similarity search.";
      }
    }

    res.status(statusCode).json({ success: false, error: message });
  }
});

app.post("/rag/query", async (req: Request, res: Response) => {
  console.log("RAG/QUERY ENDPOINT HIT");
  console.log("Body:", req.body);

  try {
    const { query, collectionId, topK } = req.body;

    if (typeof query !== "string" || !query.trim()) {
      return res.status(400).json({
        success: false,
        error: "Field 'query' is required and must be a string.",
      });
    }

    if (!collectionId || typeof collectionId !== "string") {
      return res.status(400).json({
        success: false,
        error: "Field 'collectionId' is required and must be a string.",
      });
    }

    const { processRagQuery } = await import("../modules/rag/rag.service");

    const result = await processRagQuery(
      collectionId,
      query,
      topK ?? 3
    );

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Error in /rag/query endpoint:", error);

    let message = "Internal server error.";
    let statusCode = 500;

    if (error instanceof Error) {
      const lower = error.message.toLowerCase();
      if (lower.includes("ecconnrefused") || lower.includes("connect")) {
        message = "Ollama or ChromaDB is not running or not reachable.";
      } else if (lower.includes("collection")) {
        message = "Invalid or missing collection ID.";
      } else if (lower.includes("embedding")) {
        message = "Error generating query embedding.";
      } else if (lower.includes("retrieval")) {
        message = "Error retrieving documents.";
      } else if (lower.includes("generation")) {
        message = "Error generating answer.";
      }
    }

    res.status(statusCode).json({ success: false, error: message });
  }
});

app.post("/rag/evaluate", async (req, res) => {
  try {
    const { collectionId, query, relevantDocumentIds, groundTruth } = req.body;

    if (!collectionId || !query || !Array.isArray(relevantDocumentIds)) {
      return res.status(400).json({
        success: false,
        error: "collectionId, query, and relevantDocumentIds are required",
      });
    }

    const { evaluateRagQuery } = await import(
      "../modules/evaluation/evaluation.service"
    );

    const result = await evaluateRagQuery(
      collectionId,
      query,
      relevantDocumentIds,
      groundTruth
    );

    res.json({ success: true, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Evaluation failed" });
  }
});

app.post("/rag/evaluate/batch", async (req: Request, res: Response) => {
  console.log("RAG/EVALUATE/BATCH ENDPOINT HIT");
  console.log("Body:", req.body);

  try {
    const { collectionId, dataset, evaluationModel, generationModel, maxConcurrency } = req.body;

    if (!collectionId || typeof collectionId !== "string") {
      return res.status(400).json({
        success: false,
        error: "Field 'collectionId' is required and must be a string.",
      });
    }

    if (!Array.isArray(dataset) || dataset.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Field 'dataset' is required and must be a non-empty array.",
      });
    }

    // Validate dataset items
    for (let i = 0; i < dataset.length; i++) {
      const item = dataset[i];
      if (typeof item.query !== "string" || !item.query.trim()) {
        return res.status(400).json({
          success: false,
          error: `Dataset item ${i} must have a non-empty 'query' string.`,
        });
      }

      if (!Array.isArray(item.relevantDocumentIds)) {
        return res.status(400).json({
          success: false,
          error: `Dataset item ${i} must have 'relevantDocumentIds' array.`,
        });
      }
    }

    const { evaluateRagQueryBatch } = await import(
      "../modules/evaluation/evaluation.service"
    );

    const result = await evaluateRagQueryBatch(
      collectionId,
      dataset,
      evaluationModel,
      generationModel,
      maxConcurrency ?? 2
  );

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Error in /rag/evaluate/batch endpoint:", error);

    let message = "Internal server error.";
    let statusCode = 500;

    if (error instanceof Error) {
      const lower = error.message.toLowerCase();
      if (lower.includes("ecconnrefused") || lower.includes("connect")) {
        message = "Ollama or ChromaDB is not running or not reachable.";
      } else if (lower.includes("collection")) {
        message = "Invalid or missing collection ID.";
      } else if (lower.includes("evaluation")) {
        message = "Error during batch evaluation.";
      }
    }

    res.status(statusCode).json({ success: false, error: message });
  }
});

app.post("/rag/evaluate/multimodel", async (req: Request, res: Response) => {
  console.log("RAG/EVALUATE/MULTIMODEL ENDPOINT HIT");
  console.log("Body:", req.body);

  try {
    const { collectionId, dataset, models, maxConcurrency } = req.body;

    if (!collectionId || typeof collectionId !== "string") {
      return res.status(400).json({
        success: false,
        error: "Field 'collectionId' is required and must be a string.",
      });
    }

    if (!Array.isArray(dataset) || dataset.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Field 'dataset' is required and must be a non-empty array.",
      });
    }

    const modelsToUse = Array.isArray(models)
      ? models
      : ["mistral", "llama3.2:1b"];

    const { evaluateRagQueryBatchMultiModel } = await import(
      "../modules/evaluation/evaluation.service"
    );

    const result = await evaluateRagQueryBatchMultiModel(
      collectionId,
      dataset,
      modelsToUse,
      maxConcurrency ?? 2
    );

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Error in /rag/evaluate/multimodel endpoint:", error);

    res.status(500).json({
      success: false,
      error: "Multi-model evaluation failed",
    });
  }
});

app.get("/rag/leaderboard", (_req: Request, res: Response) => {
  res.json({
    success: true,
    message: "Use /rag/evaluate/multimodel to generate leaderboard",
    documentation: {
      endpoint: "POST /rag/evaluate/multimodel",
      payload: {
        collectionId: "string",
        dataset: [
          {
            query: "string",
            relevantDocumentIds: ["string"],
            groundTruth: "string (optional)",
          },
        ],
        models: ["mistral", "llama3.2:1b"],
        maxConcurrency: 2,
      },
    },
  });
});

// GET benchmark history
app.get("/benchmark/history", async (_req: Request, res: Response) => {
  try {
    const { readBenchmarkHistory } = await import("../modules/evaluation/evaluation.service");
    const data = await readBenchmarkHistory();
    res.json({ success: true, data });
  } catch (error) {
    console.error("Error reading benchmark history:", error);
    res.status(500).json({ success: false, error: "Failed to read history" });
  }
});

export default app;
