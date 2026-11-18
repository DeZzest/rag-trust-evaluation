import fetch from "node-fetch";
import { embeddingConfig } from "../embeddings/embedding.service";
import { snapshotEmbeddingMetadata, assertSnapshotEmbeddingMetadata } from "../vector/embedding.identity";

const CHROMA_BASE_URL =
  process.env.CHROMA_BASE_URL ?? "http://localhost:8000";

// Chroma v2 multi-tenant configuration
const TENANT = "default";
const DATABASE = "default";
const CHROMA_API_BASE = `${CHROMA_BASE_URL}/api/v2/tenants/${TENANT}/databases/${DATABASE}`;

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
 * Ensure the database exists in Chroma v2
 * Creates it if it doesn't exist
 * @returns Promise<void>
 */
export async function ensureDatabaseExists(): Promise<void> {
  try {
    // Check if database exists
    const listResponse = await fetch(
      `${CHROMA_BASE_URL}/api/v2/tenants/${TENANT}/databases`
    );

    if (!listResponse.ok) {
      throw new Error("Failed to list databases");
    }

    const databases = (await listResponse.json()) as Array<{ name: string }>;
    const exists = databases.some((db) => db.name === DATABASE);

    if (exists) {
      console.log(
        `✅ Database "${DATABASE}" exists in tenant "${TENANT}"`
      );
      return;
    }

    // Database doesn't exist, create it
    console.log(
      `📍 Database "${DATABASE}" not found. Creating it...`
    );

    const createResponse = await fetch(
      `${CHROMA_BASE_URL}/api/v2/tenants/${TENANT}/databases`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: DATABASE,
        }),
      }
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(
        `Failed to create database: ${errorText}`
      );
    }

    console.log(
      `✅ Database "${DATABASE}" created successfully in tenant "${TENANT}"`
    );
  } catch (error) {
    console.error("Error ensuring database exists:", error);
    throw error;
  }
}

/**
 * Create or get a collection from ChromaDB v2
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

    // 1️⃣ Get all collections from scoped tenant/database
    const listResponse = await fetch(`${CHROMA_API_BASE}/collections`);

    if (!listResponse.ok) {
      const errorText = await listResponse.text();
      throw new Error(`Failed to list collections: ${errorText}`);
    }

    const json = await listResponse.json();

    // Handle both array and object response formats
    const collections = Array.isArray(json)
      ? json
      : json.collections ?? [];

    // Check if collection already exists
    const existing = collections.find(
      (c: any) => c.name === collectionName
    );
    if (existing) {
      collectionCache.set(collectionName, existing.id);
      console.log(
        `✅ Collection "${collectionName}" already exists (id: ${existing.id})`
      );
      return { id: existing.id, name: existing.name };
    }

    // 2️⃣ Create new collection
    const createResponse = await fetch(`${CHROMA_API_BASE}/collections`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: collectionName,
        metadata: { "hnsw:space": "cosine" },
      }),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Failed to create collection: ${errorText}`);
    }

    const created = (await createResponse.json()) as {
      id: string;
      name: string;
    };

    collectionCache.set(collectionName, created.id);
    console.log(
      `✅ Collection "${collectionName}" created successfully (id: ${created.id})`
    );

    return { id: created.id, name: created.name };
  } catch (error) {
    throw error;
  }
}

/**
 * Strict create-only path for an immutable reviewed snapshot.
 * Unlike getOrCreateCollection(), this MUST fail if the name already exists.
 * Never return an existing collection or mutate the legacy active index.
 */
export async function createExclusiveSnapshotCollection(
  collectionName: string
): Promise<CollectionInfo> {
  if (!/^rag_snapshot_[a-f0-9]{64}$/.test(collectionName)) {
    throw new Error("Snapshot collection name must be rag_snapshot_<64-hex>");
  }
  const listResponse = await fetch(CHROMA_API_BASE + "/collections");
  if (!listResponse.ok) {
    throw new Error("Cannot check whether snapshot collection exists: " +
      (await listResponse.text()));
  }
  const json: any = await listResponse.json();
  const collections: any[] = Array.isArray(json) ? json : (json.collections ?? []);
  if (!Array.isArray(collections)) {
    throw new Error("Chroma returned an invalid collection listing");
  }
  if (collections.some(item => item && item.name === collectionName)) {
    throw new Error("Snapshot collection already exists: " + collectionName +
      ". Do not reuse or overwrite it.");
  }
  // Server-side get_or_create:false is essential even if our preflight misses a race.
  const result = await fetch(CHROMA_API_BASE + "/collections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: collectionName,
      get_or_create: false,
      metadata: snapshotEmbeddingMetadata(collectionName, embeddingConfig.model),
    }),
  });
  if (!result.ok) {
    throw new Error("Exclusive snapshot collection creation failed (no reuse): " +
      (await result.text()));
  }
  const created = await result.json() as { id?: unknown; name?: unknown };
  if (typeof created.id !== "string" || created.name !== collectionName) {
    throw new Error("Chroma returned an unexpected collection identity; inspect manually");
  }
  collectionCache.set(collectionName, created.id);
  return { id: created.id, name: collectionName };
}

/**
 * Read-only exact lookup for an already indexed, approved snapshot.
 * NEVER creates a collection, never uses the potentially stale name cache.
 */
export async function getExistingSnapshotCollection(
  collectionName: string
): Promise<CollectionInfo> {
  if (!/^rag_snapshot_[a-f0-9]{64}$/.test(collectionName)) {
    throw new Error("Invalid snapshot collection name");
  }
  const response = await fetch(CHROMA_API_BASE + "/collections");
  if (!response.ok) {
    throw new Error("Unable to list snapshot collections: " + response.status);
  }
  const raw: any = await response.json();
  const collections: any[] = Array.isArray(raw) ? raw : raw?.collections;
  if (!Array.isArray(collections)) {
    throw new Error("Unexpected Chroma collection listing");
  }
  const matches = collections.filter(
    entry => entry && entry.name === collectionName &&
      typeof entry.id === "string" && entry.id.length > 0
  );
  if (matches.length !== 1) {
    throw new Error("Approved snapshot collection missing or ambiguous; no collection created");
  }
  assertSnapshotEmbeddingMetadata(collectionName, embeddingConfig.model, matches[0].metadata);
  return { name: collectionName, id: matches[0].id };
}

/**
 * Add documents with embeddings to a collection (Chroma v2)
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

    // Prepare data in Chroma v2 format
    const ids = documents.map((doc) => doc.id);
    const embeddings = documents.map((doc) => doc.embedding);
    const documents_text = documents.map((doc) => doc.text);
    const metadatas = documents.map((doc) => doc.metadata ?? {});

    const response = await fetch(
      `${CHROMA_API_BASE}/collections/${collectionId}/add`,
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
 * Perform similarity search on a collection (Chroma v2)
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
      `${CHROMA_API_BASE}/collections/${collectionId}/query`,
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
 * Read-only complete collection scan for a reviewed snapshot audit.
 * Chroma v2 /get supports offset, limit and explicit include fields.
 * This method does not create, modify, or cache collections.
 */
export interface SnapshotStoredRecord {
  id: string;
  text: string;
  metadata: Record<string, string | number | boolean>;
  embedding: number[];
}

export async function getSnapshotRecordsPage(
  collectionId: string,
  offset: number,
  limit: number
): Promise<SnapshotStoredRecord[]> {
  if (!collectionId.trim() ||
      !Number.isInteger(offset) || offset < 0 ||
      !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("Invalid read-only Chroma snapshot page request");
  }
  const response = await fetch(
    CHROMA_API_BASE + "/collections/" + encodeURIComponent(collectionId) + "/get",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offset,
        limit,
        include: ["documents", "metadatas", "embeddings"],
      }),
    }
  );
  if (!response.ok) {
    throw new Error("Chroma read-only snapshot get failed: HTTP " + response.status);
  }
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Chroma get response");
  }
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.ids) ||
      !Array.isArray(body.documents) ||
      !Array.isArray(body.metadatas) ||
      !Array.isArray(body.embeddings) ||
      body.ids.length !== body.documents.length ||
      body.ids.length !== body.metadatas.length ||
      body.ids.length !== body.embeddings.length ||
      body.ids.length > limit) {
    throw new Error("Malformed or incomplete Chroma get arrays");
  }
  return body.ids.map((value, index) => {
    const text = (body.documents as unknown[])[index];
    const metadata = (body.metadatas as unknown[])[index];
    const embedding = (body.embeddings as unknown[])[index];
    if (typeof value !== "string" || !value.trim() ||
        typeof text !== "string" ||
        !metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
        !Array.isArray(embedding)) {
      throw new Error("Invalid Chroma record on page at offset " + offset);
    }
    const entries = Object.entries(metadata as Record<string, unknown>);
    if (entries.some(([, x]) => (
      !(typeof x === "string" || typeof x === "boolean" ||
        (typeof x === "number" && Number.isFinite(x)))
    ))) {
      throw new Error("Invalid Chroma metadata on page at offset " + offset);
    }
    if (!embedding.every(x => typeof x === "number" && Number.isFinite(x))) {
      throw new Error("Invalid Chroma embedding on page at offset " + offset);
    }
    return {
      id: value,
      text,
      metadata: metadata as Record<string, string | number | boolean>,
      embedding: embedding as number[],
    };
  });
}

/**
 * Delete a document from a collection (Chroma v2)
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
      `${CHROMA_API_BASE}/collections/${collectionId}/delete`,
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
 * Get collection count (Chroma v2)
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
      `${CHROMA_API_BASE}/collections/${collectionId}/count`
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
  apiBase: CHROMA_API_BASE,
  tenant: TENANT,
  database: DATABASE,
};