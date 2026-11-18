import type { RagQueryResult } from "./rag.service";
import type { RagQueryOptions } from "./types";
import type { SnapshotIndexPlan } from "../vector/snapshot.index";
import { collectionNameForSnapshot } from "../vector/snapshot.index";

export interface ApprovedSnapshotConfig {
  snapshotDir: string;
  snapshotId: string;
  allowPartial: boolean;
}

export type ApprovedSnapshotRequest = {
  query: string;
  topK?: number;
  year?: number;
  documentType?: string;
  generationModel?: string;
  evaluationModel?: string;
  includeFaithfulness?: boolean;
  includeClaimGrounding?: boolean;
};

export interface SnapshotQueryDependencies {
  verifySnapshot: (dir: string, id: string) => SnapshotIndexPlan;
  findExistingCollection: (name: string) => Promise<{ id: string; name: string }>;
  getCollectionCount: (id: string) => Promise<number>;
  runRag: (
    collectionId: string, query: string, options: RagQueryOptions
  ) => Promise<RagQueryResult>;
}

export function readApprovedSnapshotConfig(
  env: NodeJS.ProcessEnv
): ApprovedSnapshotConfig {
  const dir = env.RAG_APPROVED_SNAPSHOT_DIR;
  const id = env.RAG_APPROVED_SNAPSHOT_ID;
  if (!dir || !dir.trim() || !id || !id.trim()) {
    throw new Error("Approved snapshot not configured by server operator");
  }
  collectionNameForSnapshot(id);
  if (env.RAG_ALLOW_PARTIAL_SNAPSHOT !== undefined &&
      !["true", "false"].includes(env.RAG_ALLOW_PARTIAL_SNAPSHOT)) {
    throw new Error("RAG_ALLOW_PARTIAL_SNAPSHOT must be true or false");
  }
  return {
    snapshotDir: dir,
    snapshotId: id,
    allowPartial: env.RAG_ALLOW_PARTIAL_SNAPSHOT === "true",
  };
}

export function validateSnapshotQueryRequest(input: unknown): ApprovedSnapshotRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Snapshot request must be an object");
  }
  const request = input as Record<string, unknown>;
  const allowed = new Set([
    "query", "topK", "year", "documentType", "generationModel",
    "evaluationModel", "includeFaithfulness", "includeClaimGrounding"
  ]);
  for (const key of Object.keys(request)) {
    if (!allowed.has(key)) {
      throw new Error("Snapshot request field not allowed: " + key);
    }
  }
  if (typeof request.query !== "string" || !request.query.trim() ||
      !/[\p{L}\p{N}]/u.test(request.query)) {
    throw new Error("query must contain meaningful letters or digits");
  }
  if (request.topK !== undefined && (
    typeof request.topK !== "number" ||
    !Number.isInteger(request.topK) ||
    request.topK < 1 || request.topK > 20
  )) throw new Error("topK must be an integer between 1 and 20");
  if (request.year !== undefined && (
    typeof request.year !== "number" || !Number.isInteger(request.year) ||
    request.year < 1900 || request.year > 2200
  )) throw new Error("year must be a four-digit integer");
  for (const name of ["documentType", "generationModel", "evaluationModel"]) {
    if (request[name] !== undefined &&
        (typeof request[name] !== "string" || !(request[name] as string).trim())) {
      throw new Error(name + " must be a nonempty string");
    }
  }
  for (const name of ["includeFaithfulness", "includeClaimGrounding"]) {
    if (request[name] !== undefined && typeof request[name] !== "boolean") {
      throw new Error(name + " must be boolean");
    }
  }
  return input as ApprovedSnapshotRequest;
}

/**
 * Separate read-only query path. The approved collection cannot be chosen
 * by the caller and is NEVER created automatically.
 */
export async function runApprovedSnapshotQuery(
  config: ApprovedSnapshotConfig,
  request: ApprovedSnapshotRequest,
  deps: SnapshotQueryDependencies
): Promise<{
  corpusSnapshotId: string;
  collectionName: string;
  collectionId: string;
  indexedChunkCount: number;
  partialSnapshot: boolean;
  result: RagQueryResult;
}> {
  const expectedCollection = collectionNameForSnapshot(config.snapshotId);
  const plan = deps.verifySnapshot(config.snapshotDir, config.snapshotId);
  if (plan.corpusSnapshotId !== config.snapshotId ||
      plan.collectionName !== expectedCollection ||
      !Number.isInteger(plan.chunkCount) || plan.chunkCount < 1 ||
      plan.rows.length !== plan.chunkCount) {
    throw new Error("Approved snapshot failed local integrity checks");
  }
  if (!plan.completeForPdfManifest && !config.allowPartial) {
    throw new Error("Partial approved snapshot requires explicit server permission");
  }
  const collection = await deps.findExistingCollection(expectedCollection);
  if (collection.name !== expectedCollection || !collection.id) {
    throw new Error("Existing Chroma collection identity mismatch");
  }
  const count = await deps.getCollectionCount(collection.id);
  if (count !== plan.chunkCount) {
    throw new Error(
      "Snapshot collection count mismatch: expected " + plan.chunkCount + ", got " + count
    );
  }
  const result = await deps.runRag(collection.id, request.query, {
    topK: request.topK ?? 3,
    year: request.year,
    documentType: request.documentType,
    generationModel: request.generationModel,
    evaluationModel: request.evaluationModel,
    includeFaithfulness: request.includeFaithfulness,
    includeClaimGrounding: request.includeClaimGrounding,
    expectedSnapshotId: config.snapshotId,
  });
  return {
    corpusSnapshotId: config.snapshotId,
    collectionName: expectedCollection,
    collectionId: collection.id,
    indexedChunkCount: count,
    partialSnapshot: !plan.completeForPdfManifest,
    result,
  };
}
