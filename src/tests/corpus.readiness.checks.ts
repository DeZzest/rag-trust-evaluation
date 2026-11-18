import assert from "assert/strict";
import { prepareAnnotationQueue } from "../modules/evaluation/annotation.queue";
import { auditCorpusReadiness } from "../modules/evaluation/corpus.readiness";

// Synthetic data only; these assertions are not research findings.
const corpus = [
  JSON.stringify({
    text: "Коротко",
    metadata: {
      documentId: "fictional_policy", year: 2026,
      section: "1", url: "https://example.org/policy",
    },
  }),
  JSON.stringify({
    text: "Умовні заяви до 15 серпня включно.",
    metadata: {
      documentId: "fictional_policy", year: 2026,
      section: "1", url: "https://example.org/policy",
    },
  }),
  JSON.stringify({
    text: "Умовні заяви до 15 серпня включно.",
    metadata: {
      documentId: "fictional_policy", year: 2026,
      section: "1", url: "https://example.org/policy",
    },
  }),
  JSON.stringify({
    text: "Положення про умовну мобільність студентів.",
    metadata: {
      documentId: "fictional_policy_2026_pdf_1", year: 2026,
      section: "2", url: "https://example.org/policy.pdf",
    },
  }),
].join("\n") + "\n";

const queries = JSON.stringify({
  id: "synthetic-queries",
  dataset: [
    { id: "q1", query: "Які строки?", relevantDocumentIds: ["fictional_policy_2026.txt"] },
    { id: "q2", query: "Які правила?", relevantDocumentIds: ["fictional_policy_2026.txt"] },
    { id: "q3", query: "Чи є інший наказ?", relevantDocumentIds: ["absent_2026.txt"] },
  ],
});

function testReadiness(): void {
  const queue = prepareAnnotationQueue(corpus, queries, 2);
  const report = auditCorpusReadiness(corpus, queue);
  assert.equal(report.schemaVersion, "corpus-readiness/1");
  assert.equal(report.totalChunks, 4);
  assert.equal(report.distinctDocumentIds, 2);
  assert.equal(report.distinctSourceUrls, 2);
  assert.equal(report.declaredYearCounts["2026"], 4);
  assert.equal(report.shortChunksUnder30, 1);
  assert.equal(report.shortChunkRate, 0.25);
  assert.equal(report.exactDuplicateTexts, 1);
  assert.equal(report.pdfDerivedChunks, 1);
  assert.equal(report.pdfDerivedDocumentIds, 1);
  assert.equal(report.queue.caseCount, 3);
  assert.equal(report.queue.casesWithoutCandidates, 1);
  assert.equal(report.queue.missingDocumentReferences, 1);
  assert.equal(report.queue.sourceAssignments, 4);
  assert.equal(report.queue.distinctCandidateSourceIds, 2);
  assert.equal(report.queue.reusedCandidateSourceIds, 2);
  assert.equal(report.queue.candidateUniquenessRatio, 0.5);
  assert.equal(report.queue.candidateCoverageOfCorpus, 0.5);
  assert.ok(report.warnings.includes("short_chunk_rate_ge_20_percent"));
  assert.ok(report.warnings.includes("single_declared_year_check_document_version_authenticity"));
  assert.ok(report.warnings.includes("pdf_derived_documents_require_review_of_provenance"));
  assert.ok(report.warnings.includes("cases_without_candidate_sources"));
  assert.deepEqual(auditCorpusReadiness(corpus, queue), report);
}

function testInputValidation(): void {
  const queue = prepareAnnotationQueue(corpus, queries, 2);
  assert.throws(
    () => auditCorpusReadiness(corpus + "\n", queue),
    /corpus snapshot SHA-256 mismatch/
  );

  const invalidQueue = JSON.parse(JSON.stringify(queue));
  invalidQueue.cases[0].candidateSources[0].text = "fake claim";
  assert.throws(
    () => auditCorpusReadiness(corpus, invalidQueue),
    /candidate content hash mismatch/
  );
  const missingSource = JSON.parse(JSON.stringify(queue));
  const original = missingSource.cases[0].candidateSources[0];
  original.text = "Completely invented chunk text from an external source";
  const crypto = require("crypto") as typeof import("crypto");
  original.contentSha256 = crypto.createHash("sha256").update(original.text).digest("hex");
  assert.throws(
    () => auditCorpusReadiness(corpus, missingSource),
    /candidate source not present in corpus/
  );
  const duplicated = JSON.parse(JSON.stringify(queue));
  duplicated.cases[0].candidateSources.push({ ...duplicated.cases[0].candidateSources[0] });
  assert.throws(() => auditCorpusReadiness(corpus, duplicated), /duplicate candidate ID/);
  assert.throws(() => auditCorpusReadiness(corpus, {}), /annotation queue schema/);
}

testReadiness();
testInputValidation();
console.log("Corpus readiness checks passed (synthetic fixtures only).");
