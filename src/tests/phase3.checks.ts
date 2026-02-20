import assert from "assert/strict";
import { buildContext, buildContextTrace } from "../modules/rag/context.builder";
import { extractAndValidateCitations } from "../modules/rag/citation.extractor";
import { calculateTrustScore } from "../modules/rag/trust.score";
import { RetrievedChunk } from "../modules/rag/types";
import { calculateRetrievalMetrics } from "../modules/evaluation/retrieval.metrics";
import { SearchResult } from "../modules/vector-db/chroma.service";

function approxEqual(actual: number, expected: number, epsilon = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `Expected ${expected}, received ${actual}`
  );
}

function testContextBuilder() {
  const chunks: RetrievedChunk[] = [
    {
      id: "admission_rules_2024_3.2",
      text: "Minimum admission score: 75/100.",
      distance: 0.13,
      confidence: 0.87,
      documentId: "admission_rules",
      documentYear: 2024,
      subsection: "3.2",
    },
  ];

  const context = buildContext(chunks);
  assert.ok(
    context.includes(
      "[admission_rules_2024 | Section 3.2 | Confidence 0.87]\nMinimum admission score: 75/100."
    )
  );

  const trace = buildContextTrace(chunks);
  assert.equal(trace.length, 1);
  assert.equal(trace[0].citationNumber, 1);
  assert.equal(trace[0].sourceId, "admission_rules_2024_3.2");
}

function testCitationExtraction() {
  const validAnswer =
    "Minimum admission score is 75/100 [1]. Tuition is 35,000 UAH [2].";
  const valid = extractAndValidateCitations(validAnswer, 2);
  assert.equal(valid.isValid, true);
  assert.deepEqual(valid.uniqueCitations, [1, 2]);
  approxEqual(valid.coverage, 1);
  approxEqual(valid.citationValidity, 1);

  const invalidReference = extractAndValidateCitations(
    "Minimum score is 75/100 [3].",
    2
  );
  assert.equal(invalidReference.isValid, false);
  assert.deepEqual(invalidReference.invalidCitations, [3]);

  const lowCoverage = extractAndValidateCitations(
    "The minimum admission score is 75/100 [1]. Annual tuition is 35,000 UAH.",
    2
  );
  assert.equal(lowCoverage.isValid, false);
  approxEqual(lowCoverage.coverage, 0.5);
}

function testTrustScore() {
  const light = calculateTrustScore({
    mode: "lightweight",
    retrievalQuality: 1,
    citationCoverage: 1,
    citationValidity: 1,
  });
  approxEqual(light.score, 1);

  const lightCapped = calculateTrustScore({
    mode: "lightweight",
    retrievalQuality: 1,
    citationCoverage: 1,
    citationValidity: 1,
    citationInvalidAfterRetry: true,
  });
  approxEqual(lightCapped.score, 0.35);

  const full = calculateTrustScore({
    mode: "full",
    precisionAtK: 1,
    faithfulnessScore: 1,
    answerSimilarityToGroundTruth: 1,
    citationCoverage: 1,
    citationValidity: 1,
    weights: {
      faithfulness: 0.4,
      precision: 0.3,
      similarity: 0.3,
    },
  });
  approxEqual(full.score, 1);

  const fullCapped = calculateTrustScore({
    mode: "full",
    precisionAtK: 1,
    faithfulnessScore: 1,
    answerSimilarityToGroundTruth: 1,
    citationCoverage: 1,
    citationValidity: 1,
    citationInvalidAfterRetry: true,
    weights: {
      faithfulness: 0.4,
      precision: 0.3,
      similarity: 0.3,
    },
  });
  approxEqual(fullCapped.score, 0.6);
}

function testDocumentLevelRetrievalMetrics() {
  const retrievedDocs: SearchResult[] = [
    {
      id: "admission_rules_2024_3.2",
      text: "Minimum admission score: 75/100.",
      distance: 0.1,
      metadata: {
        documentId: "admission_rules",
        year: 2024,
      },
    },
    {
      id: "exam_retake_policy_na_2.1",
      text: "Retakes are limited to two attempts.",
      distance: 0.2,
      metadata: {
        documentId: "exam_retake_policy",
      },
    },
  ];

  const metrics = calculateRetrievalMetrics(retrievedDocs, [
    "admission_rules_2024.txt",
    "exam_retake_policy.txt",
  ]);

  approxEqual(metrics.precisionAtK, 1);
  approxEqual(metrics.recallAtK, 1);
  approxEqual(metrics.averageSimilarity, (0.9 + 0.8) / 2);

  const empty = calculateRetrievalMetrics([], ["admission_rules_2024.txt"]);
  approxEqual(empty.precisionAtK, 0);
  approxEqual(empty.recallAtK, 0);
  approxEqual(empty.averageSimilarity, 0);
}

function run() {
  testContextBuilder();
  testCitationExtraction();
  testTrustScore();
  testDocumentLevelRetrievalMetrics();
  console.log("Phase 3 checks passed.");
}

run();
