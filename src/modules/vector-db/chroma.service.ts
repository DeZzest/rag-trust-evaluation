import fetch from "node-fetch";

const CHROMA_BASE_URL =
  process.env.CHROMA_BASE_URL ?? "http://localhost:8000";

/**
 * Map to store collection names and their IDs in memory
 */
const collectionCache: Map<string, string> = new Map();

/**
 * Interface for document to be stored in Chroma
 */
export interface ChromaDocument {
  id: string;
  text: string;
  embedding: number[];
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Interface for search results
 */
export interface SearchResult {
  id: string;
  text: string;
  distance: number;
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Interface for collection response
 */
export interface CollectionInfo {
  id: string;
  name: string;
}

/**
 * Create or get a collection from ChromaDB
 * @param collectionName - Name of the collection
 * @returns Promise<CollectionInfo> - Collection info with id
 */
export async function getOrCreateCollection(
  collectionName: string
): Promise<CollectionInfo> {
  try {
    // Check cache first
    const cachedId = collectionCache.get(collectionName);
    if (cachedId) {
      console.log(
        `✅ Collection "${collectionName}" found in cache (id: ${cachedId})`
      );
      return { id: cachedId, name: collectionName };
    }

    // Try to get existing collection
    const listResponse = await fetch(`${CHROMA_BASE_URL}/api/v2/collections`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (listResponse.ok) {
      const collections = (await listResponse.json()) as Array<{
        name: string;
        id: string;
      }>;
      const existing = collections.find((c) => c.name === collectionName);

      if (existing) {
        collectionCache.set(collectionName, existing.id);
        console.log(
          `✅ Collection "${collectionName}" already exists (id: ${existing.id})`
        );
        return { id: existing.id, name: collectionName };
      }
    }

    // Collection doesn't exist, create it
    const createResponse = await fetch(`${CHROMA_BASE_URL}/api/v2/collections`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: collectionName,
        metadata: {
          hnsw: { space: "cosine" },
        },
      }),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Failed to create collection: ${errorText}`);
    }

    const data = (await createResponse.json()) as { name: string; id: string };
    collectionCache.set(collectionName, data.id);
    console.log(
      `✅ Collection "${collectionName}" created successfully (id: ${data.id})`
    );
    return { id: data.id, name: data.name };
  } catch (error) {
    throw error;
  }
}

/**
 * Add documents with embeddings to a collection
 * @param collectionId - ID of the collection
 * @param documents - Array of documents with embeddings
 * @returns Promise<void>
 */
export async function addDocuments(
  collectionId: string,
  documents: ChromaDocument[]
): Promise<void> {
  try {
    if (!collectionId || collectionId.trim().length === 0) {
      throw new Error("Collection ID cannot be empty");
    }

    if (!documents || documents.length === 0) {
      throw new Error("Documents array cannot be empty");
    }

    // Prepare data in Chroma format
    const ids = documents.map((doc) => doc.id);
    const embeddings = documents.map((doc) => doc.embedding);
    const documents_text = documents.map((doc) => doc.text);
    const metadatas = documents.map((doc) => doc.metadata ?? {});

    const response = await fetch(
      `${CHROMA_BASE_URL}/api/v2/collections/${collectionId}/upsert`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ids,
          embeddings,
          documents: documents_text,
          metadatas,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to add documents: ${errorText}`);
    }

    console.log(
      `✅ Added ${documents.length} documents to collection (id: ${collectionId})`
    );
  } catch (error) {
    throw error;
  }
}

/**
 * Perform similarity search on a collection
 * @param collectionId - ID of the collection
 * @param queryEmbedding - The embedding vector to search with
 * @param topK - Number of top results to return (default: 5)
 * @returns Promise<SearchResult[]> - Array of search results
 */
export async function similaritySearch(
  collectionId: string,
  queryEmbedding: number[],
  topK: number = 5
): Promise<SearchResult[]> {
  try {
    if (!collectionId || collectionId.trim().length === 0) {
      throw new Error("Collection ID cannot be empty");
    }

    if (!queryEmbedding || queryEmbedding.length === 0) {
      throw new Error("Query embedding cannot be empty");
    }

    const response = await fetch(
      `${CHROMA_BASE_URL}/api/v2/collections/${collectionId}/query`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query_embeddings: [queryEmbedding],
          n_results: topK,
          include: ["documents", "distances", "metadatas"],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to perform similarity search: ${errorText}`);
    }

    const data = (await response.json()) as {
      ids?: string[][];
      documents?: string[][];
      distances?: number[][];
      metadatas?: Record<string, string | number | boolean>[][];
    };

    // Transform response into SearchResult array
    const results: SearchResult[] = [];

    if (data.ids && data.ids[0]) {
      data.ids[0].forEach((id, index) => {
        results.push({
          id,
          text: data.documents?.[0]?.[index] ?? "",
          distance: data.distances?.[0]?.[index] ?? 0,
          metadata: data.metadatas?.[0]?.[index],
        });
      });
    }

    return results;
  } catch (error) {
    throw error;
  }
}

/**
 * Delete a document from a collection
 * @param collectionId - ID of the collection
 * @param documentId - ID of the document to delete
 * @returns Promise<void>
 */
export async function deleteDocument(
  collectionId: string,
  documentId: string
): Promise<void> {
  try {
    if (!collectionId || collectionId.trim().length === 0) {
      throw new Error("Collection ID cannot be empty");
    }

    const response = await fetch(
      `${CHROMA_BASE_URL}/api/v2/collections/${collectionId}/delete`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ids: [documentId],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to delete document: ${errorText}`);
    }

    console.log(`✅ Deleted document "${documentId}" from collection`);
  } catch (error) {
    throw error;
  }
}

/**
 * Get collection count
 * @param collectionId - ID of the collection
 * @returns Promise<number> - Number of documents in collection
 */
export async function getCollectionCount(
  collectionId: string
): Promise<number> {
  try {
    if (!collectionId || collectionId.trim().length === 0) {
      throw new Error("Collection ID cannot be empty");
    }

    const response = await fetch(
      `${CHROMA_BASE_URL}/api/v2/collections/${collectionId}/count`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get collection count: ${errorText}`);
    }

    const data = (await response.json()) as number;
    return data;
  } catch (error) {
    throw error;
  }
}

/**
 * Clear collection cache
 */
export function clearCollectionCache(): void {
  collectionCache.clear();
  console.log("✅ Collection cache cleared");
}

export const chromaConfig = {
  baseUrl: CHROMA_BASE_URL,
};