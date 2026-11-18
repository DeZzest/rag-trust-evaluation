import assert from "assert/strict";
import { collectionNameForSnapshot } from "../modules/vector/snapshot.index";
import type { SnapshotIndexPlan } from "../modules/vector/snapshot.index";
import type { RagQueryResult } from "../modules/rag/rag.service";
import type { RetrievedChunk } from "../modules/rag/types";
import { assertSnapshotEvidence } from "../modules/rag/snapshot.provenance";
import {
  readApprovedSnapshotConfig,
  runApprovedSnapshotQuery,
  validateSnapshotQueryRequest,
  SnapshotQueryDependencies,
} from "../modules/rag/snapshot.query";

// Synthetic fixtures only. Not experiments on the university corpus.
const ID = "sha256:" + "a".repeat(64);
const CHUNK = "chunk-" + "b".repeat(24);
const HASH = "c".repeat(64);

function source(): RetrievedChunk {
  return {
    id: CHUNK,
    text: "Умовна перевірена сторінка зі штучного документа.",
    distance: 0.2,
    confidence: 0.8,
    documentId: "synthetic_policy",
    documentYear: 2024,
    documentType: "regulations",
    section: "1",
    subsection: "1.1",
    metadata: {
      documentId: "synthetic_policy",
      corpusSnapshotId: ID,
      reviewStatus: "approved",
      documentVersion: "synthetic-v1",
      chunkId: CHUNK,
      pageNumber: 1,
      sourcePdfSha256: HASH,
      reviewedTextSha256: HASH,
    },
  };
}

function fixturePlan(complete: boolean): SnapshotIndexPlan {
  return {
    corpusSnapshotId: ID,
    collectionName: collectionNameForSnapshot(ID),
    ingestedSha256: "d".repeat(64),
    documentCount: 1,
    chunkCount: 1,
    completeForPdfManifest: complete,
    rows: [{
      id: CHUNK,
      text: source().text,
      metadata: { ...source().metadata! },
    }],
  };
}

function fakeResult(): RagQueryResult {
  return {
    answer: "Умовний факт [1].",
    sources: [{
      documentId: CHUNK,
      text: source().text,
      distance: 0.2,
      similarity: 0.8,
      metadata: { ...source().metadata! },
    }],
    contextTrace: [],
    citations: [1],
    citationValidation: {
      citations: [1], uniqueCitations: [1], invalidCitations: [],
      hasCitations: true, factualSentenceCount: 1, citedSentenceCount: 1,
      missingCitationSentenceCount: 0, coverage: 1, citationValidity: 1,
      isValid: true, retryCount: 0, issues: [],
    },
    trust: {
      score: 0.8,
      mode: "lightweight",
      breakdown: {
        mode: "lightweight", score: 0.8,
        citationCoverage: 1, citationValidity: 1,
        cappedByCitationPolicy: false,
      },
    },
    performance: {
      embeddingMs: 1, retrievalMs: 1, generationMs: 1, totalMs: 3,
    },
  };
}

function dependencies(calls: string[], complete = true): SnapshotQueryDependencies {
  return {
    verifySnapshot: (dir, id) => {
      calls.push("verify");
      assert.equal(dir, "/trusted/synthetic");
      assert.equal(id, ID);
      return fixturePlan(complete);
    },
    findExistingCollection: async (name) => {
      calls.push("find-existing");
      assert.equal(name, collectionNameForSnapshot(ID));
      return { id: "synthetic-collection-uuid", name };
    },
    getCollectionCount: async (id) => {
      calls.push("count");
      assert.equal(id, "synthetic-collection-uuid");
      return 1;
    },
    runRag: async (id, query, options) => {
      calls.push("rag");
      assert.equal(id, "synthetic-collection-uuid");
      assert.equal(query, "Яка умовна норма?");
      assert.equal(options.expectedSnapshotId, ID);
      assert.equal(options.topK, 3);
      // In production this guard runs in processRagQuery BEFORE calling LLM.
      assertSnapshotEvidence([source()], ID);
      return fakeResult();
    },
  };
}

async function testReadOnlyRoute() {
  const config = readApprovedSnapshotConfig({
    RAG_APPROVED_SNAPSHOT_DIR: "/trusted/synthetic",
    RAG_APPROVED_SNAPSHOT_ID: ID,
  });
  assert.equal(config.allowPartial, false);
  assert.throws(() => readApprovedSnapshotConfig({}), /not configured/);
  assert.throws(() => readApprovedSnapshotConfig({
    RAG_APPROVED_SNAPSHOT_DIR: "/tmp",
    RAG_APPROVED_SNAPSHOT_ID: "sha256:INVALID",
  }), /snapshotId|sha256/);
  assert.throws(() => readApprovedSnapshotConfig({
    RAG_APPROVED_SNAPSHOT_DIR: "/tmp",
    RAG_APPROVED_SNAPSHOT_ID: ID,
    RAG_ALLOW_PARTIAL_SNAPSHOT: "yes",
  }), /true or false/);

  const valid = validateSnapshotQueryRequest({
    query: "Яка умовна норма?", topK: 3, includeClaimGrounding: true,
  });
  assert.equal(valid.topK, 3);
  for (const bad of [
    { query: "Яка умовна норма?", collectionId: "legacy" },
    { query: "Яка умовна норма?", snapshotDir: "../other" },
    { query: "Яка умовна норма?", topK: 0 },
    { query: "Яка умовна норма?", topK: 1.2 },
    { query: "...!!!!" },
    { query: "Яка умовна норма?", includeFaithfulness: "true" },
  ]) {
    assert.throws(() => validateSnapshotQueryRequest(bad));
  }
  const calls: string[] = [];
  const result = await runApprovedSnapshotQuery(
    config, valid, dependencies(calls)
  );
  assert.deepEqual(calls, ["verify", "find-existing", "count", "rag"]);
  assert.equal(result.corpusSnapshotId, ID);
  assert.equal(result.partialSnapshot, false);
  assert.equal(result.collectionName, collectionNameForSnapshot(ID));
  assert.equal(result.indexedChunkCount, 1);
  assert.equal(result.result.answer, "Умовний факт [1].");
}

async function testFailClosed() {
  const config = {
    snapshotDir: "/trusted/synthetic", snapshotId: ID, allowPartial: false,
  };
  const request = { query: "Яка умовна норма?" };
  const partialCalls: string[] = [];
  await assert.rejects(
    runApprovedSnapshotQuery(config, request, dependencies(partialCalls, false)),
    /Partial approved snapshot/
  );
  assert.deepEqual(partialCalls, ["verify"]);

  const partialAllowed = await runApprovedSnapshotQuery(
    { ...config, allowPartial: true },
    request, dependencies([], false)
  );
  assert.equal(partialAllowed.partialSnapshot, true);

  const missingCalls: string[] = [];
  const missing = dependencies(missingCalls);
  missing.findExistingCollection = async () => {
    missingCalls.push("find-existing");
    throw new Error("Approved snapshot collection missing");
  };
  await assert.rejects(
    runApprovedSnapshotQuery(config, request, missing),
    /collection missing/
  );
  assert.deepEqual(missingCalls, ["verify", "find-existing"]);

  const countCalls: string[] = [];
  const badCount = dependencies(countCalls);
  badCount.getCollectionCount = async () => {
    countCalls.push("count");
    return 2;
  };
  await assert.rejects(
    runApprovedSnapshotQuery(config, request, badCount), /count mismatch/
  );
  assert.deepEqual(countCalls, ["verify", "find-existing", "count"]);

  const badPlan = dependencies([]);
  badPlan.verifySnapshot = () => ({
    ...fixturePlan(true), corpusSnapshotId: "sha256:" + "f".repeat(64),
  });
  await assert.rejects(
    runApprovedSnapshotQuery(config, request, badPlan), /integrity checks/
  );
}

function testForeignEvidence(): void {
  assertSnapshotEvidence([], ID); // Zero sources yields an abstention, not a fabricated answer.
  assertSnapshotEvidence([source()], ID);
  const change = (update: (item: RetrievedChunk) => void) => {
    const item = source();
    update(item);
    assert.throws(() => assertSnapshotEvidence([item], ID), /generation blocked/);
  };
  change(s => { s.metadata!.corpusSnapshotId = "sha256:" + "d".repeat(64); });
  change(s => { s.metadata!.reviewStatus = "pending"; });
  change(s => { s.metadata!.pageNumber = 0; });
  change(s => { s.metadata!.sourcePdfSha256 = "invalid"; });
  change(s => { s.metadata!.reviewedTextSha256 = "invalid"; });
  change(s => { s.metadata!.documentVersion = ""; });
  change(s => { s.metadata!.chunkId = "chunk-" + "e".repeat(24); });
  change(s => { s.metadata = undefined; });
  assert.throws(
    () => assertSnapshotEvidence([source()], "sha256:INVALID"),
    /invalid expected/
  );
}

async function main() {
  testForeignEvidence();
  await testReadOnlyRoute();
  await testFailClosed();
  console.log("Snapshot-bound RAG checks passed (synthetic, no Ollama/Chroma calls).");
}
void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
