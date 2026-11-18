import type { SnapshotStoredRecord } from "../vector-db/chroma.service";
import {
  collectionNameForSnapshot,
  SnapshotIndexPlan,
} from "./snapshot.index";

export interface SnapshotAuditDependencies {
  verifySnapshot: (directory: string, snapshotId: string) => SnapshotIndexPlan;
  findExistingCollection: (name: string) => Promise<{ id: string; name: string }>;
  getCollectionCount: (id: string) => Promise<number>;
  getPage: (id: string, offset: number, limit: number) => Promise<SnapshotStoredRecord[]>;
}

export interface SnapshotAuditReport {
  schemaVersion: "snapshot-chroma-audit/1";
  status: "verified";
  corpusSnapshotId: string;
  collectionName: string;
  collectionId: string;
  expectedChunkCount: number;
  actualChunkCount: number;
  comparedChunkCount: number;
  documentCount: number;
  vectorDimension: number;
  completeForPdfManifest: boolean;
  embeddingModelVerified: false;
  caveat: string;
}

function equalMetadata(
  expected: Record<string, string | number | boolean>,
  actual: Record<string, string | number | boolean>
): boolean {
  const a = Object.keys(expected).sort();
  const b = Object.keys(actual).sort();
  return a.length === b.length && a.every((key, i) => (
    key === b[i] && Object.is(expected[key], actual[key])
  ));
}

/**
 * Read-only, fully exhaustive audit. Count alone is never enough: ID, exact
 * source text, all primitive metadata and vector integrity must match.
 * This cannot infer which model produced the stored embeddings.
 */
export async function auditExistingSnapshotIndex(
  snapshotDir: string,
  expectedSnapshotId: string,
  deps: SnapshotAuditDependencies
): Promise<SnapshotAuditReport> {
  const expectedName = collectionNameForSnapshot(expectedSnapshotId);
  // Must happen before ANY network call.
  const plan = deps.verifySnapshot(snapshotDir, expectedSnapshotId);
  if (plan.corpusSnapshotId !== expectedSnapshotId ||
      plan.collectionName !== expectedName ||
      plan.rows.length !== plan.chunkCount || plan.chunkCount <= 0) {
    throw new Error("Snapshot audit: local snapshot failed integrity validation");
  }
  const expected = new Map(plan.rows.map(row => [row.id, row]));
  if (expected.size !== plan.chunkCount) {
    throw new Error("Snapshot audit: duplicate IDs in approved local snapshot");
  }
  const collection = await deps.findExistingCollection(expectedName);
  if (collection.name !== expectedName || !collection.id) {
    throw new Error("Snapshot audit: existing collection identity mismatch");
  }
  const initialCount = await deps.getCollectionCount(collection.id);
  if (initialCount !== plan.chunkCount) {
    throw new Error("Snapshot audit: collection count mismatch");
  }

  const seen = new Set<string>();
  const pageSize = 50;
  let vectorDimension: number | undefined;
  for (let offset = 0; offset < plan.chunkCount; offset += pageSize) {
    const limit = Math.min(pageSize, plan.chunkCount - offset);
    const page = await deps.getPage(collection.id, offset, limit);
    if (!Array.isArray(page) || page.length !== limit) {
      throw new Error("Snapshot audit: truncated or unexpected Chroma page at " + offset);
    }
    for (const record of page) {
      if (!record || typeof record.id !== "string" ||
          typeof record.text !== "string" || !record.metadata ||
          typeof record.metadata !== "object" || Array.isArray(record.metadata)) {
        throw new Error("Snapshot audit: malformed stored Chroma record");
      }
      const row = expected.get(record.id);
      if (!row || seen.has(record.id)) {
        throw new Error("Snapshot audit: foreign or duplicate stored record ID");
      }
      if (row.text !== record.text) {
        throw new Error("Snapshot audit: stored text differs from reviewed snapshot");
      }
      if (!equalMetadata(row.metadata, record.metadata)) {
        throw new Error("Snapshot audit: stored metadata differs from reviewed snapshot");
      }
      if (!Array.isArray(record.embedding) ||
          record.embedding.length < 1 ||
          !record.embedding.every(v => typeof v === "number" && Number.isFinite(v))) {
        throw new Error("Snapshot audit: missing or invalid stored embedding");
      }
      if (vectorDimension === undefined) vectorDimension = record.embedding.length;
      if (record.embedding.length !== vectorDimension) {
        throw new Error("Snapshot audit: inconsistent embedding dimensions");
      }
      seen.add(record.id);
    }
  }
  if (seen.size !== expected.size) {
    throw new Error("Snapshot audit: missing stored record IDs");
  }
  const finalCount = await deps.getCollectionCount(collection.id);
  if (finalCount !== initialCount) {
    throw new Error("Snapshot audit: collection changed during read-only scan");
  }
  return {
    schemaVersion: "snapshot-chroma-audit/1",
    status: "verified",
    corpusSnapshotId: expectedSnapshotId,
    collectionName: expectedName,
    collectionId: collection.id,
    expectedChunkCount: plan.chunkCount,
    actualChunkCount: finalCount,
    comparedChunkCount: seen.size,
    documentCount: plan.documentCount,
    vectorDimension: vectorDimension!,
    completeForPdfManifest: plan.completeForPdfManifest,
    embeddingModelVerified: false,
    caveat: "Read-only audit compares all IDs, exact text and metadata, and checks vector shapes. It does NOT establish embedding model identity, vector correctness or validity of human reviews.",
  };
}
