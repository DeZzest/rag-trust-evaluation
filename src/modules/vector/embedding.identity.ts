import crypto from "crypto";

/**
 * Minimal, DECLARED embedding configuration identity.
 *
 * This binds a snapshot collection to an embedding MODEL TAG, not to the
 * actual model-weight digest. An empirical run must additionally record the
 * Ollama version and model digest from the running machine.
 */
const COLLECTION = /^rag_snapshot_([a-f0-9]{64})$/;
const MODEL_TAG = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

export type EmbeddingCollectionMetadata = {
  "hnsw:space": "cosine";
  "rag:snapshot_id": string;
  "rag:embedding_model": string;
  "rag:embedding_api": "ollama:/api/embeddings";
  "rag:embedding_config_sha256": string;
};

/** Pure function: no environment variables, files or HTTP calls. */
export function snapshotEmbeddingMetadata(
  collectionName: string,
  embeddingModel: string
): EmbeddingCollectionMetadata {
  const match = COLLECTION.exec(collectionName);
  if (!match) {
    throw new Error("Embedding identity: expected a snapshot-only collection name");
  }
  if (typeof embeddingModel !== "string" || !MODEL_TAG.test(embeddingModel)) {
    throw new Error("Embedding identity: nonempty valid embedding model tag required");
  }
  const snapshotId = "sha256:" + match[1];
  const api = "ollama:/api/embeddings";
  // This is a configuration checksum, NOT a digest of the model's weights.
  const fingerprint = crypto.createHash("sha256")
    .update(JSON.stringify(["snapshot-embedding-config/1", snapshotId, embeddingModel, api, "cosine"]))
    .digest("hex");
  return {
    "hnsw:space": "cosine",
    "rag:snapshot_id": snapshotId,
    "rag:embedding_model": embeddingModel,
    "rag:embedding_api": api,
    "rag:embedding_config_sha256": fingerprint,
  };
}

/** Fail closed if Chroma omits or changes expected embedding provenance. */
export function assertSnapshotEmbeddingMetadata(
  collectionName: string,
  embeddingModel: string,
  actual: unknown
): void {
  const expected = snapshotEmbeddingMetadata(collectionName, embeddingModel);
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
    throw new Error("Snapshot embedding metadata missing: cannot verify model tag");
  }
  const record = actual as Record<string, unknown>;
  for (const [key, value] of Object.entries(expected)) {
    if (record[key] !== value) {
      throw new Error("Snapshot embedding metadata mismatch at " + key +
        ": refusing unverified vector space");
    }
  }
}
