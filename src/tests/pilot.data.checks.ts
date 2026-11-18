import assert from "assert/strict";
import fs from "fs";
import path from "path";

// This checks DATA FORMAT only, not expert correctness or source validity.
const root = path.resolve(__dirname, "../../");
function file<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(root, name), "utf8")) as T;
}
type Doc = {
  documentId: string; sourcePdfSha256: string; pageCount: number;
  verifiedDocumentYear: null; documentVersion: null; reviewStatus: string;
};
type SourceSelection = {
  schemaVersion: string; status: string; documents: Doc[];
  totalDocuments: number; totalPhysicalPdfPages: number;
};
type Seed = {
  id: string; query: string; documentId: string | null; pageHints: number[];
  designIntent: string; expertVerdict: null; expertEvidence: null; reviewStatus: string;
};
type Seeds = {
  schemaVersion: string; count: number; questions: Seed[]; provisionalOnly: boolean;
};
type Query = {
  id: string; query: string; relevantDocumentIds: string[];
  expectedSourceSection?: string; reviewStatus: string; designIntent: string;
};
type Queries = {id: string; provisional: boolean; dataset: Query[]};

const source = file<SourceSelection>("data/benchmark/pilot-source-selection.json");
const seeds = file<Seeds>("data/benchmark/pilot-question-seeds.json");
const queries = file<Queries>("data/benchmark/pilot-eval-queries.json");

assert.equal(source.schemaVersion, "pilot-source-selection/1");
assert.equal(source.status, "human_review_pending");
assert.equal(source.totalDocuments, 3);
assert.equal(source.documents.length, 3);
assert.equal(source.totalPhysicalPdfPages, 28);
assert.equal(source.documents.reduce((n, d) => n + d.pageCount, 0), 28);

const docs = new Map(source.documents.map(d => [d.documentId, d]));
assert.equal(docs.size, 3);
for (const doc of source.documents) {
  assert.match(doc.sourcePdfSha256, /^[a-f0-9]{64}$/);
  assert.equal(doc.verifiedDocumentYear, null);
  assert.equal(doc.documentVersion, null);
  assert.equal(doc.reviewStatus, "needs_human_review");
}

assert.equal(seeds.schemaVersion, "pilot-question-seeds/1");
assert.equal(seeds.provisionalOnly, true);
assert.equal(seeds.count, 29);
assert.equal(seeds.questions.length, 29);
assert.equal(queries.dataset.length, 29);
assert.equal(queries.provisional, true);

const ids = new Set<string>();
for (const [idx, q] of seeds.questions.entries()) {
  assert.equal(q.id, "pilot-q" + String(idx + 1).padStart(2, "0"));
  assert.ok(!ids.has(q.id), "duplicate question ID");
  ids.add(q.id);
  assert.ok(q.query.length > 20);
  assert.equal(q.expertVerdict, null);
  assert.equal(q.expertEvidence, null);
  assert.equal(q.reviewStatus, "unreviewed");
  if (q.documentId) {
    const doc = docs.get(q.documentId);
    assert.ok(doc, "candidate source must exist in selection");
    for (const page of q.pageHints) {
      assert.ok(Number.isInteger(page) && page >= 1 && page <= doc!.pageCount,
        "page hints must point inside actual PDF page range");
    }
  } else {
    assert.equal(q.designIntent, "out_of_scope_probe");
  }
  const c = queries.dataset[idx];
  assert.equal(c.id, q.id);
  assert.equal(c.query, q.query);
  assert.equal(c.designIntent, q.designIntent);
  assert.equal(c.reviewStatus, "unreviewed");
  assert.ok(c.relevantDocumentIds.length >= 1);
  assert.ok(c.relevantDocumentIds.every(id => docs.has(id)));
  if (q.documentId !== null) assert.deepEqual(c.relevantDocumentIds, [q.documentId]);
  if (q.pageHints.length > 0) {
    assert.equal(c.expectedSourceSection, "Section " + q.pageHints[0]);
  }
}
const byIntent = (intent: string) => seeds.questions.filter(q => q.designIntent === intent).length;
assert.equal(byIntent("source_finding"), 25);
assert.equal(byIntent("contradiction_probe"), 2);
assert.equal(byIntent("out_of_scope_probe"), 2);

console.log("Real-source pilot metadata/seed structure checked; still NOT expert gold.");
