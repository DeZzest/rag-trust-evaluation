import assert from "assert/strict";
import { prepareAnnotationQueue } from "../modules/evaluation/annotation.queue";
import { validateGoldBenchmark } from "../modules/evaluation/benchmark.gold";

// These examples are entirely fictional and do not establish research results.
function syntheticCorpus(): string {
  return [
    JSON.stringify({
      text: "Умовний порядок вступу: заяви приймаються до 15 серпня.",
      metadata: {
        documentId: "lute_admission_rules",
        year: 2025,
        section: "1",
      },
    }),
    JSON.stringify({
      text: "Умовний порядок прийому 2026. Секція про вступ.",
      metadata: {
        documentId: "lute_admission_rules",
        year: 2026,
        section: "1",
      },
    }),
    JSON.stringify({
      text: "Умовний розділ 4 щодо академічної мобільності.",
      metadata: {
        documentId: "lute_regulations",
        year: 2026,
        section: "4",
        subsection: "4.1",
        url: "https://example.org/fictional",
      },
    }),
    JSON.stringify({
      text: "Умовний розділ 2 щодо структури університету.",
      metadata: {
        documentId: "lute_regulations",
        year: 2026,
        section: "2",
      },
    }),
  ].join("\n") + "\n";
}

function syntheticQueries(): string {
  return JSON.stringify({
    id: "synthetic-only",
    dataset: [
      {
        id: "q01",
        query: "Які умовні правила вступу діють у 2026?",
        relevantDocumentIds: ["lute_admission_rules_2026.txt"],
      },
      {
        id: "q02",
        query: "Які документи регулюють мобільність?",
        relevantDocumentIds: ["lute_regulations_2026.txt"],
        expectedSourceSection: "Section 4",
      },
      {
        id: "q03",
        query: "Де знайти правила іншого закладу?",
        relevantDocumentIds: ["other_university_2026.txt"],
      },
    ],
  });
}

function testCandidateGeneration(): void {
  const corpus = syntheticCorpus();
  const queries = syntheticQueries();
  const queue = prepareAnnotationQueue(corpus, queries, 2);
  assert.equal(queue.schemaVersion, "annotation-queue/1");
  assert.equal(queue.cases.length, 3);
  assert.equal(queue.originDatasetId, "synthetic-only");
  assert.ok(queue.corpusSnapshotId.startsWith("sha256:"));
  assert.equal(queue.cases[0].candidateSources.length, 1);
  assert.equal(queue.cases[0].candidateSources[0].declaredYear, 2026);
  assert.equal(queue.cases[0].candidateSources[0].versionVerified, false);
  assert.equal(queue.cases[1].candidateSources.length, 2);
  assert.equal(queue.cases[1].candidateSources[0].section, "4");
  assert.deepEqual(queue.cases[2].candidateSources, []);
  assert.deepEqual(queue.cases[2].missingDocumentIds, ["other_university_2026.txt"]);
  for (const c of queue.cases) {
    assert.equal(c.status, "needs_manual_annotation");
    assert.equal("groundTruth" in c, false);
    assert.equal("verdict" in c, false);
  }
  assert.throws(() => validateGoldBenchmark(queue), /unsupported schemaVersion/);

  assert.deepEqual(prepareAnnotationQueue(corpus, queries, 2), queue);
  const changed = corpus.replace("Секція про вступ", "Змінена секція");
  assert.notEqual(prepareAnnotationQueue(changed, queries, 2).corpusSnapshotId, queue.corpusSnapshotId);
  assert.notEqual(prepareAnnotationQueue(corpus, queries + " ", 2).queriesSha256, queue.queriesSha256);
  assert.equal(prepareAnnotationQueue(corpus, queries, 1).cases[1].candidateSources.length, 1);
}

function testBadInputs(): void {
  const corpus = syntheticCorpus();
  const queries = syntheticQueries();
  assert.throws(() => prepareAnnotationQueue(corpus, queries, 0), /maxPerDocument/);
  assert.throws(() => prepareAnnotationQueue(corpus, "not JSON"), /invalid JSON/);
  assert.throws(() => prepareAnnotationQueue("", queries), /no valid chunks/);
  assert.throws(() => prepareAnnotationQueue(corpus + "{not-json}\n", queries), /invalid JSON/);
  assert.throws(() => prepareAnnotationQueue(
    JSON.stringify({ text: "Example", metadata: { year: 2026 } }), queries
  ), /documentId/);
  assert.throws(() => prepareAnnotationQueue(
    JSON.stringify({ text: "Example", metadata: { documentId: "example_2025", year: 2026 } }),
    queries
  ), /year conflict/);

  const dup = JSON.parse(queries) as { dataset: Array<Record<string, unknown>> };
  dup.dataset.push({ ...dup.dataset[0] });
  assert.throws(() => prepareAnnotationQueue(corpus, JSON.stringify(dup)), /duplicate case ID/);
}

testCandidateGeneration();
testBadInputs();
console.log("Annotation queue offline checks passed (synthetic fixtures only).");
