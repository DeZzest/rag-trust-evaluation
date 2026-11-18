import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import type { ChromaDocument } from "../vector-db/chroma.service";

const SHA256 = /^[a-f0-9]{64}$/;
const SNAPSHOT_ID = /^sha256:([a-f0-9]{64})$/;
const COLLECTION_PREFIX = "rag_snapshot_";

type Primitive = string | number | boolean;

export interface SnapshotIndexRow {
  id: string;
  text: string;
  metadata: Record<string, Primitive>;
}

export interface SnapshotIndexPlan {
  corpusSnapshotId: string;
  collectionName: string;
  ingestedSha256: string;
  documentCount: number;
  chunkCount: number;
  completeForPdfManifest: boolean;
  rows: SnapshotIndexRow[];
}

export interface SnapshotIndexResult {
  status: "dry_run" | "indexed";
  corpusSnapshotId: string;
  collectionName: string;
  chunkCount: number;
  completeForPdfManifest: boolean;
  verifiedCollectionCount?: number;
}

export interface SnapshotIndexDependencies {
  embed: (text: string) => Promise<number[]>;
  createExclusiveCollection: (name: string) => Promise<{ id: string; name: string }>;
  addDocuments: (collectionId: string, documents: ChromaDocument[]) => Promise<void>;
  getCount: (collectionId: string) => Promise<number>;
}

function asObject(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(where + ": object required");
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, where: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(where + ": nonempty string required");
  }
  return value;
}

function hash(raw: string): string {
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

export function collectionNameForSnapshot(id: string): string {
  const found = id.match(SNAPSHOT_ID);
  if (!found) throw new Error("expectedSnapshotId: sha256:<64 lowercase hex> required");
  return COLLECTION_PREFIX + found[1];
}

/** Complements the stricter Python verifier. No network or filesystem writes. */
export function buildSnapshotIndexPlan(
  verificationInput: unknown,
  manifestInput: unknown,
  jsonl: string,
  expectedSnapshotId: string
): SnapshotIndexPlan {
  const collectionName = collectionNameForSnapshot(expectedSnapshotId);
  const verified = asObject(verificationInput, "verification");
  const manifest = asObject(manifestInput, "snapshot manifest");
  if (verified.valid !== true || manifest.schemaVersion !== "corpus-snapshot/1") {
    throw new Error("snapshot: unverified or wrong schema");
  }
  if (verified.corpusSnapshotId !== expectedSnapshotId ||
      manifest.corpusSnapshotId !== expectedSnapshotId) {
    throw new Error("snapshot: expected ID does not match verified snapshot");
  }
  const inputHash = hash(jsonl);
  if (manifest.ingestedSha256 !== inputHash || verified.ingestedSha256 !== inputHash) {
    throw new Error("snapshot: ingested SHA-256 mismatch");
  }
  const count = manifest.chunkCount;
  const documentCount = manifest.documentCount;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 ||
      typeof documentCount !== "number" || !Number.isInteger(documentCount) || documentCount < 1 ||
      verified.chunkCount !== count || verified.documentCount !== documentCount) {
    throw new Error("snapshot: inconsistent document or chunk count");
  }
  if (typeof manifest.completeForPdfManifest !== "boolean" ||
      verified.completeForPdfManifest !== manifest.completeForPdfManifest) {
    throw new Error("snapshot: missing completeness declaration");
  }

  const rawLines = jsonl.split(/\r?\n/).filter(x => x.length > 0);
  if (rawLines.length !== count) throw new Error("snapshot: JSONL row count mismatch");
  const chunkIds = new Set<string>();
  const documents = new Set<string>();
  const rows: SnapshotIndexRow[] = rawLines.map((line, index) => {
    let parsed: unknown;
    try { parsed = JSON.parse(line); }
    catch { throw new Error("snapshot: invalid JSONL on row " + (index + 1)); }
    const item = asObject(parsed, "row " + (index + 1));
    const text = requiredText(item.text, "row " + (index + 1) + ".text");
    const original = asObject(item.metadata, "row " + (index + 1) + ".metadata");

    if (original.corpusSnapshotId !== expectedSnapshotId ||
        original.reviewStatus !== "approved") {
      throw new Error("row " + (index + 1) + ": unapproved or wrong corpus snapshot");
    }
    const chunkId = requiredText(original.chunkId, "row " + (index + 1) + ".chunkId");
    const documentId = requiredText(original.documentId, "row " + (index + 1) + ".documentId");
    requiredText(original.documentVersion, "row " + (index + 1) + ".documentVersion");
    requiredText(original.sourcePdfSha256, "row " + (index + 1) + ".sourcePdfSha256");
    requiredText(original.reviewedTextSha256, "row " + (index + 1) + ".reviewedTextSha256");
    if (!/^chunk-[a-f0-9]{24}$/.test(chunkId) ||
        !SHA256.test(original.sourcePdfSha256 as string) ||
        !SHA256.test(original.reviewedTextSha256 as string) ||
        chunkIds.has(chunkId)) {
      throw new Error("row " + (index + 1) + ": invalid hash or duplicate chunk ID");
    }
    if (typeof original.pageNumber !== "number" ||
        !Number.isInteger(original.pageNumber) || original.pageNumber < 1) {
      throw new Error("row " + (index + 1) + ": physical pageNumber required");
    }
    chunkIds.add(chunkId);
    documents.add(documentId);
    const metadata: Record<string, Primitive> = {};
    for (const [key, value] of Object.entries(original)) {
      if (typeof value === "string" || typeof value === "boolean") metadata[key] = value;
      else if (typeof value === "number" && Number.isFinite(value)) metadata[key] = value;
      else if (value !== undefined && value !== null) {
        throw new Error("row " + (index + 1) + ": unsupported Chroma metadata at " + key);
      }
    }
    return { id: chunkId, text, metadata };
  });
  if (documents.size !== documentCount) {
    throw new Error("snapshot: indexed documents do not match manifest count");
  }
  return {
    corpusSnapshotId: expectedSnapshotId,
    collectionName,
    ingestedSha256: inputHash,
    documentCount,
    chunkCount: count,
    completeForPdfManifest: manifest.completeForPdfManifest as boolean,
    rows,
  };
}

/** Python verifier MUST succeed before any Ollama/Chroma call is possible. */
export function loadVerifiedSnapshotIndexPlan(
  snapshotDir: string,
  expectedSnapshotId: string
): SnapshotIndexPlan {
  collectionNameForSnapshot(expectedSnapshotId);
  const absoluteDir = path.resolve(snapshotDir);
  const script = path.resolve(__dirname, "../../../scripts/verify_reviewed_snapshot.py");
  const python = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  let verification: unknown;
  try {
    const stdout = execFileSync(
      python, [script, "--snapshot-dir", absoluteDir],
      { encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 }
    );
    verification = JSON.parse(stdout);
  } catch (error) {
    throw new Error("snapshot: offline verifier rejected input; refusing indexing: " +
      (error instanceof Error ? error.message : String(error)));
  }
  const manifest: unknown = JSON.parse(
    fs.readFileSync(path.join(absoluteDir, "snapshot_manifest.json"), "utf8")
  );
  const jsonl = fs.readFileSync(path.join(absoluteDir, "ingested_corpus.jsonl"), "utf8");
  return buildSnapshotIndexPlan(verification, manifest, jsonl, expectedSnapshotId);
}

export async function executeSnapshotIndex(
  plan: SnapshotIndexPlan,
  deps: SnapshotIndexDependencies,
  options: { execute: boolean; allowPartial: boolean; activeCollection: string }
): Promise<SnapshotIndexResult> {
  const summary = {
    corpusSnapshotId: plan.corpusSnapshotId,
    collectionName: plan.collectionName,
    chunkCount: plan.chunkCount,
    completeForPdfManifest: plan.completeForPdfManifest,
  };
  if (!options.execute) return { status: "dry_run", ...summary };

  if (!plan.completeForPdfManifest && !options.allowPartial) {
    throw new Error("snapshot: partial corpus requires explicit --allow-partial");
  }
  if (plan.collectionName === options.activeCollection) {
    throw new Error("snapshot: target collection is configured as active RAG collection");
  }
  if (plan.collectionName !== collectionNameForSnapshot(plan.corpusSnapshotId) ||
      plan.rows.length !== plan.chunkCount) {
    throw new Error("snapshot: invalid index plan");
  }

  // Precompute and validate ALL embeddings BEFORE creating a collection.
  const withEmbeddings: ChromaDocument[] = [];
  let expectedDimension: number | undefined;
  for (const [i, row] of plan.rows.entries()) {
    const vector = await deps.embed(row.text);
    if (!Array.isArray(vector) || vector.length === 0 ||
        !vector.every(v => typeof v === "number" && Number.isFinite(v))) {
      throw new Error("embedding " + (i + 1) + ": invalid vector; no Chroma writes performed");
    }
    if (expectedDimension === undefined) expectedDimension = vector.length;
    if (vector.length !== expectedDimension) {
      throw new Error("embedding " + (i + 1) + ": inconsistent dimension; no Chroma writes performed");
    }
    withEmbeddings.push({ id: row.id, text: row.text, metadata: row.metadata, embedding: vector });
  }

  // Existing collections, including partially populated ones, must abort.
  const collection = await deps.createExclusiveCollection(plan.collectionName);
  if (!collection.id || collection.name !== plan.collectionName) {
    throw new Error("Chroma returned unexpected collection; manual inspection required");
  }
  try {
    for (let offset = 0; offset < withEmbeddings.length; offset += 16) {
      await deps.addDocuments(collection.id, withEmbeddings.slice(offset, offset + 16));
    }
    const actualCount = await deps.getCount(collection.id);
    if (actualCount !== withEmbeddings.length) {
      throw new Error("collection count mismatch: " + actualCount + " vs " + withEmbeddings.length);
    }
    return { status: "indexed", ...summary, verifiedCollectionCount: actualCount };
  } catch (error) {
    throw new Error("Snapshot indexing incomplete for " + plan.collectionName +
      "; collection may be PARTIALLY populated. Do not use for RAG or experiments; inspect manually. " +
      "Underlying error: " + (error instanceof Error ? error.message : String(error)));
  }
}
