import assert from "assert/strict";
import crypto from "crypto";
import {
  buildSnapshotIndexPlan,
  collectionNameForSnapshot,
  executeSnapshotIndex,
  SnapshotIndexDependencies,
  SnapshotIndexPlan,
} from "../modules/vector/snapshot.index";

// FICTIONAL regression fixtures; NOT a real university corpus or experimental result.
const SNAPSHOT_ID = "sha256:" + "a".repeat(64);
const FAKEDOC = "fictional_document";
const HASHPDF = "b".repeat(64);
const HASHPAGE = "c".repeat(64);

function fixture(length = 17, complete = true) {
  const records = Array.from({ length }, (_, index) => ({
    text: "Fictional regulation content, fragment " + (index + 1),
    metadata: {
      corpusSnapshotId: SNAPSHOT_ID,
      reviewStatus: "approved",
      chunkId: "chunk-" + (index + 1).toString(16).padStart(24, "0"),
      documentId: FAKEDOC,
      documentVersion: "fictional-2024-v1",
      year: 2024,
      sourcePdfSha256: HASHPDF,
      reviewedTextSha256: HASHPAGE,
      pageNumber: Math.floor(index / 4) + 1,
      section: String(Math.floor(index / 4) + 1),
      subsection: String(Math.floor(index / 4) + 1) + "." + ((index % 4) + 1),
      source: "example.org",
    },
  }));
  const raw = records.map(item => JSON.stringify(item)).join("\n") + "\n";
  const ingestedSha256 = crypto.createHash("sha256").update(raw).digest("hex");
  const manifest = {
    schemaVersion: "corpus-snapshot/1",
    corpusSnapshotId: SNAPSHOT_ID,
    ingestedSha256,
    documentCount: 1,
    chunkCount: length,
    completeForPdfManifest: complete,
  };
  const verification = {
    valid: true,
    corpusSnapshotId: SNAPSHOT_ID,
    ingestedSha256,
    documentCount: 1,
    chunkCount: length,
    completeForPdfManifest: complete,
  };
  return { records, raw, manifest, verification };
}

function plan(length = 17, complete = true): SnapshotIndexPlan {
  const f = fixture(length, complete);
  return buildSnapshotIndexPlan(f.verification, f.manifest, f.raw, SNAPSHOT_ID);
}

function checkStaticValidation(): void {
  const p = plan();
  assert.equal(p.collectionName, "rag_snapshot_" + "a".repeat(64));
  assert.equal(p.rows.length, 17);
  assert.equal(p.rows[0].metadata.corpusSnapshotId, SNAPSHOT_ID);
  assert.equal(p.rows[0].metadata.pageNumber, 1);
  assert.equal(p.documentCount, 1);
  assert.throws(() => collectionNameForSnapshot("sha256:wrong"), /sha256/);

  const changed = fixture(2);
  const original = changed.raw;
  const doCheck = (manifest: unknown, verification: unknown, jsonl: string, id: string, match: RegExp) => {
    assert.throws(
      () => buildSnapshotIndexPlan(verification, manifest, jsonl, id),
      match
    );
  };
  doCheck(changed.manifest, changed.verification, original, "sha256:" + "d".repeat(64), /expected ID/);
  doCheck(changed.manifest, changed.verification, original + " ", SNAPSHOT_ID, /ingested SHA-256 mismatch/);
  doCheck({ ...changed.manifest, chunkCount: 999 }, changed.verification, original, SNAPSHOT_ID, /inconsistent/);
  doCheck(changed.manifest, { ...changed.verification, valid: false }, original, SNAPSHOT_ID, /unverified/);

  const mutatedRows = changed.records.map(item => ({ ...item, metadata: { ...item.metadata } }));
  mutatedRows[1].metadata.chunkId = mutatedRows[0].metadata.chunkId;
  const dup = mutatedRows.map(x => JSON.stringify(x)).join("\n") + "\n";
  const dupHash = crypto.createHash("sha256").update(dup).digest("hex");
  doCheck({ ...changed.manifest, ingestedSha256: dupHash },
    { ...changed.verification, ingestedSha256: dupHash }, dup, SNAPSHOT_ID, /duplicate chunk ID/);

  mutatedRows[1].metadata.chunkId = "chunk-" + "9".repeat(24);
  mutatedRows[0].metadata.reviewStatus = "pending";
  const pending = mutatedRows.map(x => JSON.stringify(x)).join("\n") + "\n";
  const pendingHash = crypto.createHash("sha256").update(pending).digest("hex");
  doCheck({ ...changed.manifest, ingestedSha256: pendingHash },
    { ...changed.verification, ingestedSha256: pendingHash }, pending, SNAPSHOT_ID, /unapproved/);

  assert.deepEqual(changed.records, JSON.parse("[" +
    original.trim().split("\n").join(",") + "]"));
}

function fakeDependencies(calls: string[], badEmbeddingAt?: number): SnapshotIndexDependencies {
  let embeddingCount = 0;
  let inserted = 0;
  return {
    embed: async (_text) => {
      embeddingCount++;
      calls.push("embed");
      return embeddingCount === badEmbeddingAt ? [NaN] : [0.1, 0.2, 0.3];
    },
    createExclusiveCollection: async (name) => {
      calls.push("create");
      assert.equal(name, collectionNameForSnapshot(SNAPSHOT_ID));
      return { id: "fictional-id", name };
    },
    addDocuments: async (id, docs) => {
      calls.push("add:" + docs.length);
      assert.equal(id, "fictional-id");
      assert.ok(docs.length <= 16);
      for (const d of docs) {
        assert.equal(d.metadata?.corpusSnapshotId, SNAPSHOT_ID);
        assert.equal(d.metadata?.reviewStatus, "approved");
        assert.ok(d.id.startsWith("chunk-"));
        assert.ok(d.text.startsWith("Fictional regulation"));
      }
      inserted += docs.length;
    },
    getCount: async (id) => {
      calls.push("count");
      assert.equal(id, "fictional-id");
      return inserted;
    },
  };
}

async function checkSafeExecution() {
  const calls: string[] = [];
  const deps = fakeDependencies(calls);
  const options = { execute: false, allowPartial: false, activeCollection: "lute_university_docs" };
  const dryRun = await executeSnapshotIndex(plan(), deps, options);
  assert.equal(dryRun.status, "dry_run");
  assert.deepEqual(calls, []);

  await assert.rejects(
    executeSnapshotIndex(plan(1, false), deps, { ...options, execute: true }),
    /--allow-partial/
  );
  assert.deepEqual(calls, []);
  await assert.rejects(
    executeSnapshotIndex(plan(), deps, {
      ...options, execute: true, activeCollection: collectionNameForSnapshot(SNAPSHOT_ID),
    }),
    /active RAG collection/
  );
  assert.deepEqual(calls, []);

  const result = await executeSnapshotIndex(plan(), deps, { ...options, execute: true });
  assert.equal(result.status, "indexed");
  assert.equal(result.verifiedCollectionCount, 17);
  assert.equal(calls.filter(x => x === "embed").length, 17);
  assert.deepEqual(calls.slice(17), ["create", "add:16", "add:1", "count"]);

  const partialCalls: string[] = [];
  const partial = await executeSnapshotIndex(
    plan(1, false),
    fakeDependencies(partialCalls),
    { ...options, execute: true, allowPartial: true }
  );
  assert.equal(partial.status, "indexed");
  assert.equal(partial.completeForPdfManifest, false);

  const failureCalls: string[] = [];
  await assert.rejects(
    executeSnapshotIndex(
      plan(3), fakeDependencies(failureCalls, 2), { ...options, execute: true }
    ),
    /invalid vector; no Chroma writes/
  );
  assert.equal(failureCalls.includes("create"), false);
}

async function checkBrokenIndexHandling(): Promise<void> {
  const p = plan(2);
  const options = {
    execute: true, allowPartial: false, activeCollection: "lute_university_docs",
  };
  let created = false;
  let countCalled = false;
  const existsDeps = fakeDependencies([]);
  existsDeps.createExclusiveCollection = async () => {
    throw new Error("Snapshot collection already exists");
  };
  await assert.rejects(
    executeSnapshotIndex(p, existsDeps, options),
    /already exists/
  );

  const badDeps = fakeDependencies([]);
  badDeps.createExclusiveCollection = async (name) => {
    created = true;
    return { id: "fictional-id", name };
  };
  badDeps.addDocuments = async () => {
    throw new Error("offline simulated Chroma failure");
  };
  badDeps.getCount = async () => {
    countCalled = true;
    return 2;
  };
  await assert.rejects(
    executeSnapshotIndex(p, badDeps, options),
    /PARTIALLY populated/
  );
  assert.equal(created, true);
  assert.equal(countCalled, false);

  const wrongCount = fakeDependencies([]);
  wrongCount.getCount = async () => 1;
  await assert.rejects(
    executeSnapshotIndex(p, wrongCount, options),
    /collection count mismatch/
  );
}

async function main(): Promise<void> {
  checkStaticValidation();
  await checkSafeExecution();
  await checkBrokenIndexHandling();
  console.log("Snapshot indexing checks passed (synthetic only; no HTTP calls).");
}
void main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
