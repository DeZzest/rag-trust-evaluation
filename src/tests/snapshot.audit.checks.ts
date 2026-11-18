import assert from "assert/strict";
import { auditExistingSnapshotIndex, SnapshotAuditDependencies } from "../modules/vector/snapshot.audit";
import { SnapshotIndexPlan, collectionNameForSnapshot } from "../modules/vector/snapshot.index";
import type { SnapshotStoredRecord } from "../modules/vector-db/chroma.service";

// Entirely fictional data; no OCR or university sources.
const ID = "sha256:" + "a".repeat(64);
const NAME = collectionNameForSnapshot(ID);

function fixture(length = 53): {
  plan: SnapshotIndexPlan;
  stored: SnapshotStoredRecord[];
} {
  const stored = Array.from({length}, (_, i): SnapshotStoredRecord => ({
    id: "chunk-" + (i + 1).toString(16).padStart(24, "0"),
    text: "Умовний текст про нормативну дату № " + i,
    metadata: {
      documentId: "fictional_doc",
      corpusSnapshotId: ID,
      documentVersion: "fictional-v1",
      pageNumber: i + 1,
      reviewStatus: "approved",
      sourcePdfSha256: "b".repeat(64),
      chunkId: "chunk-" + (i + 1).toString(16).padStart(24, "0"),
    },
    embedding: [0.1, 0.2, 0.3],
  }));
  const plan: SnapshotIndexPlan = {
    corpusSnapshotId: ID,
    collectionName: NAME,
    ingestedSha256: "c".repeat(64),
    documentCount: 1,
    chunkCount: stored.length,
    completeForPdfManifest: true,
    rows: stored.map(row => ({
      id: row.id, text: row.text, metadata: {...row.metadata},
    })),
  };
  return {plan, stored};
}

function services(
  plan: SnapshotIndexPlan,
  rows: SnapshotStoredRecord[],
  log: string[]
): SnapshotAuditDependencies {
  return {
    verifySnapshot: (_dir, id) => {
      log.push("verify");
      assert.equal(id, ID);
      return plan;
    },
    findExistingCollection: async name => {
      log.push("lookup");
      assert.equal(name, NAME);
      return { id: "fictional-uuid", name };
    },
    getCollectionCount: async _id => {
      log.push("count");
      return rows.length;
    },
    getPage: async (_id, offset, limit) => {
      log.push("page:" + offset + ":" + limit);
      return rows.slice(offset, offset + limit);
    },
  };
}

async function testCompleteAudit(): Promise<void> {
  const {plan, stored} = fixture();
  const log: string[] = [];
  const output = await auditExistingSnapshotIndex(
    "fictional-dir", ID, services(plan, stored, log)
  );
  assert.equal(output.status, "verified");
  assert.equal(output.comparedChunkCount, 53);
  assert.equal(output.vectorDimension, 3);
  assert.equal(output.embeddingModelVerified, false);
  assert.equal(output.corpusSnapshotId, ID);
  assert.deepEqual(log, [
    "verify", "lookup", "count", "page:0:50", "page:50:3", "count"
  ]);
  const changedOrder = [...stored].reverse();
  const reorderOutput = await auditExistingSnapshotIndex(
    "fictional-dir", ID, services(plan, changedOrder, [])
  );
  assert.equal(reorderOutput.comparedChunkCount, 53);
}

async function expectRejected(
  message: RegExp,
  update: (plan: SnapshotIndexPlan, rows: SnapshotStoredRecord[],
           deps: SnapshotAuditDependencies, calls: string[]) => void
): Promise<void> {
  const {plan, stored} = fixture(2);
  const calls: string[] = [];
  const deps = services(plan, stored, calls);
  update(plan, stored, deps, calls);
  await assert.rejects(
    auditExistingSnapshotIndex("fictional-dir", ID, deps), message
  );
}

async function testTampering(): Promise<void> {
  await expectRejected(/stored text differs/, (_p, r) => {
    r[1].text = "Інше, підмінене формулювання";
  });
  await expectRejected(/stored metadata differs/, (_p, r) => {
    r[0].metadata.documentVersion = "wrong-version";
  });
  await expectRejected(/foreign or duplicate/, (_p, r) => {
    r[1].id = r[0].id;
  });
  await expectRejected(/foreign or duplicate/, (_p, r) => {
    r[1].id = "chunk-" + "f".repeat(24);
  });
  await expectRejected(/missing or invalid stored embedding/, (_p, r) => {
    r[1].embedding = [Number.NaN];
  });
  await expectRejected(/missing or invalid stored embedding/, (_p, r) => {
    r[1].embedding = [];
  });
  await expectRejected(/inconsistent embedding dimensions/, (_p, r) => {
    r[1].embedding = [0.3, 0.5];
  });
  await expectRejected(/collection count mismatch/, (_p, r, deps) => {
    deps.getCollectionCount = async () => 3;
  });
  await expectRejected(/truncated or unexpected Chroma page/, (_p, _r, deps) => {
    deps.getPage = async () => [];
  });
  await expectRejected(/collection changed/, (_p, r, deps) => {
    let calls = 0;
    deps.getCollectionCount = async () => {
      calls++;
      return calls === 1 ? r.length : r.length + 1;
    };
  });
}

async function testEarlyFailureWithoutNetwork(): Promise<void> {
  const {plan, stored} = fixture(1);
  const calls: string[] = [];
  const deps = services(plan, stored, calls);
  plan.corpusSnapshotId = "sha256:" + "f".repeat(64);
  await assert.rejects(
    auditExistingSnapshotIndex("fictional-dir", ID, deps), /local snapshot failed/
  );
  assert.deepEqual(calls, ["verify"]);

  await expectRejected(/collection identity mismatch/, (_p, _r, deps) => {
    deps.findExistingCollection = async () => ({id: "uuid", name: "wrong"});
  });
  await expectRejected(/missing collection/, (_p, _r, deps) => {
    deps.findExistingCollection = async () => {
      throw new Error("missing collection");
    };
  });
}

void (async () => {
  await testCompleteAudit();
  await testTampering();
  await testEarlyFailureWithoutNetwork();
  console.log("Chroma snapshot audit checks passed (synthetic only; no HTTP).");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
