import assert from "assert/strict";
import { prepareAnnotationQueue } from "../modules/evaluation/annotation.queue";
import { inspectCorpusQuality } from "../modules/evaluation/corpus.quality";

// Synthetic unit-test data only; not part of the university corpus.
function input(): string {
  return [
    JSON.stringify({
      text: "No structured content extracted.",
      metadata: { documentId: "fictional_integrity", year: 2026, section: "1" },
    }),
    JSON.stringify({
      text: "A fictional regulation says students submit forms by 15 August.",
      metadata: { documentId: "fictional_regulation", year: 2026, section: "2" },
    }),
    JSON.stringify({
      text: "A fictional regulation says students submit forms by 15 August.",
      metadata: { documentId: "fictional_regulation", year: 2026, section: "2" },
    }),
    JSON.stringify({
      text: "Short.",
      metadata: { documentId: "fictional_regulation", year: 2025, section: "1" },
    }),
  ].join("\n") + "\n";
}

function testCorpusInspection(): void {
  const corpus = input();
  const result = inspectCorpusQuality(corpus);
  assert.equal(result.schemaVersion, "corpus-quality/1");
  assert.equal(result.chunkCount, 4);
  assert.equal(result.documentCount, 2);
  assert.equal(result.distinctTextCount, 3);
  assert.equal(result.repeatedTextOccurrences, 1);
  assert.equal(result.shortUnder20, 1);
  assert.equal(result.shortUnder60, 2);
  assert.equal(result.placeholderCount, 1);
  assert.equal(result.declaredYears["2026"], 3);
  assert.equal(result.declaredYears["2025"], 1);
  assert.equal(result.byDocument[0].documentId, "fictional_regulation");
  assert.equal(result.byDocument[0].chunks, 3);
  assert.deepEqual(inspectCorpusQuality(corpus), result);
}

function testQueueOverlap(): void {
  const corpus = input();
  const queries = JSON.stringify({
    id: "fictional-questions",
    dataset: [
      {
        id: "q1", query: "What does the regulation say?",
        relevantDocumentIds: ["fictional_regulation_2026.txt"],
      },
      {
        id: "q2", query: "What is the same rule?",
        relevantDocumentIds: ["fictional_regulation_2026.txt"],
      },
      {
        id: "q3", query: "Is there an academic integrity document?",
        relevantDocumentIds: ["fictional_integrity_2026.txt"],
      },
      {
        id: "q4", query: "Where is the missing document?",
        relevantDocumentIds: ["nonexistent_2026.txt"],
      },
    ],
  });
  const queue = prepareAnnotationQueue(corpus, queries, 1);
  const report = inspectCorpusQuality(corpus, queue);
  assert.equal(report.queue?.caseCount, 4);
  assert.equal(report.queue?.candidateOccurrences, 3);
  assert.equal(report.queue?.uniqueCandidateIds, 2);
  assert.equal(report.queue?.repeatedCandidateOccurrences, 1);
  assert.deepEqual(report.queue?.casesOnlyPlaceholders, ["q3"]);
  assert.deepEqual(report.queue?.casesContainingPlaceholders, ["q3"]);
  assert.deepEqual(report.queue?.casesWithoutCandidates, ["q4"]);
  assert.equal(report.queue?.missingDocumentReferences, 1);

  const otherCorpus = corpus.replace("15 August", "16 August");
  assert.throws(
    () => inspectCorpusQuality(otherCorpus, queue),
    /corpus snapshot mismatch/
  );

  const altered = JSON.parse(JSON.stringify(queue));
  altered.cases[0].candidateSources[0].text = "forged text";
  assert.throws(
    () => inspectCorpusQuality(corpus, altered),
    /source content not found/
  );
}

function testInvalidInput(): void {
  assert.throws(() => inspectCorpusQuality(""), /no usable chunks/);
  assert.throws(() => inspectCorpusQuality("{broken\n"), /invalid JSON/);
  assert.throws(() => inspectCorpusQuality(JSON.stringify({
    text: "Missing metadata",
  })), /missing metadata/);
  assert.throws(() => inspectCorpusQuality(JSON.stringify({
    text: "", metadata: { documentId: "x" },
  })), /nonempty string expected/);
  assert.throws(() => inspectCorpusQuality(input(), { schemaVersion: "gold/1" }), /unsupported schemaVersion/);
}

testCorpusInspection();
testQueueOverlap();
testInvalidInput();
console.log("Corpus quality checks passed (synthetic fixtures only).");
