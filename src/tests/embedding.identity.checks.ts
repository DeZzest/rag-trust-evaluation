import assert from "assert/strict";
import {
  snapshotEmbeddingMetadata,
  assertSnapshotEmbeddingMetadata,
} from "../modules/vector/embedding.identity";

const COLLECTION = "rag_snapshot_" + "a".repeat(64);
const MODEL = "nomic-embed-text:latest";

function checkConsistentIdentity(): void {
  const md = snapshotEmbeddingMetadata(COLLECTION, MODEL);
  assert.equal(md["hnsw:space"], "cosine");
  assert.equal(md["rag:snapshot_id"], "sha256:" + "a".repeat(64));
  assert.equal(md["rag:embedding_model"], MODEL);
  assert.equal(md["rag:embedding_api"], "ollama:/api/embeddings");
  assert.match(md["rag:embedding_config_sha256"], /^[a-f0-9]{64}$/);
  assert.deepEqual(snapshotEmbeddingMetadata(COLLECTION, MODEL), md);
  assertSnapshotEmbeddingMetadata(COLLECTION, MODEL, md);
  // Chroma may add non-experiment metadata, but cannot alter required fields.
  assertSnapshotEmbeddingMetadata(COLLECTION, MODEL, { ...md, "other:key": 1 });
}

function checkRejectsUnverifiedEmbeddingSpace(): void {
  const md = snapshotEmbeddingMetadata(COLLECTION, MODEL);
  assert.throws(() => snapshotEmbeddingMetadata("lute_university_docs", MODEL), /snapshot-only/);
  assert.throws(() => snapshotEmbeddingMetadata("rag_snapshot_invalid", MODEL), /snapshot-only/);
  assert.throws(() => snapshotEmbeddingMetadata(COLLECTION, ""), /model tag/);
  assert.throws(() => snapshotEmbeddingMetadata(COLLECTION, "bad model"), /model tag/);
  assert.throws(() => assertSnapshotEmbeddingMetadata(COLLECTION, MODEL, null), /missing/);
  assert.throws(() => assertSnapshotEmbeddingMetadata(COLLECTION, MODEL, {}), /mismatch/);

  assert.throws(
    () => assertSnapshotEmbeddingMetadata(COLLECTION, "another-embed:latest", md),
    /mismatch/
  );
  for (const field of [
    "rag:snapshot_id", "rag:embedding_model",
    "rag:embedding_api", "rag:embedding_config_sha256", "hnsw:space",
  ] as const) {
    assert.throws(() => assertSnapshotEmbeddingMetadata(
      COLLECTION, MODEL, { ...md, [field]: "tampered" }
    ), /mismatch/);
  }
  const differentCollection = "rag_snapshot_" + "b".repeat(64);
  assert.notEqual(
    snapshotEmbeddingMetadata(differentCollection, MODEL)["rag:embedding_config_sha256"],
    md["rag:embedding_config_sha256"]
  );
  assert.notEqual(
    snapshotEmbeddingMetadata(COLLECTION, "mxbai-embed-large")["rag:embedding_config_sha256"],
    md["rag:embedding_config_sha256"]
  );
}

checkConsistentIdentity();
checkRejectsUnverifiedEmbeddingSpace();
console.log("Embedding configuration pin checks passed (synthetic, no Chroma/Ollama).");
