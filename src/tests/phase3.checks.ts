import assert from "assert/strict";
import { buildContext, buildContextTrace } from "../modules/rag/context.builder";
import { refuseAfterInvalidCitations } from "../modules/rag/rag.service";
import { extractAndValidateCitations } from "../modules/rag/citation.extractor";
import { calculateTrustScore } from "../modules/rag/trust.score";
import { RetrievedChunk } from "../modules/rag/types";
import { calculateRetrievalMetrics } from "../modules/evaluation/retrieval.metrics";
import { parseFaithfulnessScore } from "../modules/evaluation/faithfulness.service";
import { parseClaimGroundingResponse, unavailableClaimGrounding } from "../modules/evaluation/claim.grounding";
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

function testFailClosedAfterCitationRetry() {
  // Regresses the real pilot failure: out-of-scope question, retry failed,
  // source snippets previously presented as a fully cited "answer".
  for (const query of ["Який розмір стипендії?", "What is the grant amount?"]) {
    const result = refuseAfterInvalidCitations(query, 1);
    assert.equal(result.citations.length, 0);
    assert.equal(result.citationValidation.hasCitations, false);
    assert.equal(result.citationValidation.isValid, false);
    assert.equal(result.citationValidation.coverage, 0);
    assert.equal(result.citationValidation.citationValidity, 0);
    assert.equal(result.citationValidation.retryCount, 1);
    assert.deepEqual(result.citationValidation.issues, [
      "citation_validation_failed_after_retry",
    ]);
    assert.equal(/\[\d+\]/.test(result.answer), false);
    assert.equal(result.answer.includes("Фрагмент із джерела"), false);
    const guardedTrust = calculateTrustScore({
      mode: "lightweight",
      retrievalQuality: 0.74,
      citationCoverage: result.citationValidation.coverage,
      citationValidity: result.citationValidation.citationValidity,
      citationInvalidAfterRetry: true,
    });
    assert.ok(guardedTrust.score <= 0.35,
      "Failed citation validation must not yield a high trust score");
  }
  const ukr = refuseAfterInvalidCitations("Який розмір стипендії?", 0);
  assert.equal(ukr.citationValidation.retryCount, 1);
  assert.ok(ukr.answer.includes("Не вдалося"));
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

function testRecallWithDuplicateChunks() {
  const retrievedDocs: SearchResult[] = [
    {
      id: "admission_rules_2024_3.1",
      text: "Required document A.",
      distance: 0.1,
      metadata: { documentId: "admission_rules", year: 2024 },
    },
    {
      id: "admission_rules_2024_3.2",
      text: "Required document B.",
      distance: 0.2,
      metadata: { documentId: "admission_rules", year: 2024 },
    },
  ];

  // Both chunks belong to one unique relevant document. A duplicate
  // must not produce recall=2 when there is only one ground-truth document.
  const oneRelevant = calculateRetrievalMetrics(retrievedDocs, [
    "admission_rules_2024.txt",
  ]);
  approxEqual(oneRelevant.precisionAtK, 1);
  approxEqual(oneRelevant.recallAtK, 1);

  // One relevant document out of two: recall must be 0.5 even when
  // multiple chunks of the found document occupy the retrieved list.
  const twoRelevant = calculateRetrievalMetrics(retrievedDocs, [
    "admission_rules_2024.txt",
    "exam_retake_policy.txt",
  ]);
  approxEqual(twoRelevant.precisionAtK, 1);
  approxEqual(twoRelevant.recallAtK, 0.5);

  // Duplicate ground-truth IDs must not alter recall.
  const duplicatedGroundTruth = calculateRetrievalMetrics(retrievedDocs, [
    "admission_rules_2024.txt",
    "admission_rules_2024.txt",
  ]);
  approxEqual(duplicatedGroundTruth.recallAtK, 1);

  // With no annotated relevant documents, the defined recall fallback is 0.
  const emptyGroundTruth = calculateRetrievalMetrics(retrievedDocs, []);
  approxEqual(emptyGroundTruth.recallAtK, 0);
}

function testFaithfulnessJudgeValidation() {
  approxEqual(parseFaithfulnessScore('{"score":0,"reason":"unsupported"}'), 0);
  approxEqual(parseFaithfulnessScore('{"score":1,"reason":"supported"}'), 1);
  approxEqual(parseFaithfulnessScore('  {"score":0.65}  '), 0.65);

  const invalidResponses = [
    "",
    "The faithfulness is 0.8",
    "0.8",
    "null",
    "[]",
    '{"reason":"no score"}',
    '{"score":"0.5"}',
    '{"score":null}',
    '{"score":-0.1}',
    '{"score":1.2}',
    '{"score":{}}',
  ];

  for (const response of invalidResponses) {
    assert.throws(
      () => parseFaithfulnessScore(response),
      /faithfulness_evaluation_invalid_(json|score)/,
      `Invalid judge response must fail: ${JSON.stringify(response)}`
    );
  }
}

function testTrustScoreWithoutGroundTruth() {
  const weights = { faithfulness: 0.4, precision: 0.3, similarity: 0.3 };
  const input = {
    mode: "full" as const,
    precisionAtK: 0,
    faithfulnessScore: 1,
    citationCoverage: 1,
    citationValidity: 1,
    weights,
  };
  const withoutReference = calculateTrustScore(input);
  approxEqual(withoutReference.baseScore!, 0.4 / 0.7);
  approxEqual(withoutReference.score, 0.8 * (0.4 / 0.7) + 0.2);
  assert.equal(withoutReference.referenceAvailable, false);
  assert.equal(withoutReference.answerSimilarityToGroundTruth, undefined);
  assert.equal(withoutReference.semanticCompensationApplied, false);

  const withReference = calculateTrustScore({
    ...input,
    answerSimilarityToGroundTruth: 0.5,
  });
  approxEqual(withReference.baseScore!, 0.4 + 0.3 * 0.5);
  approxEqual(withReference.score, 0.8 * 0.55 + 0.2);
  assert.equal(withReference.referenceAvailable, true);
  approxEqual(withReference.answerSimilarityToGroundTruth!, 0.5);

  assert.throws(
    () => calculateTrustScore({ ...input, answerSimilarityToGroundTruth: Number.NaN }),
    /Invalid answer similarity measurement/
  );
  assert.throws(
    () => calculateTrustScore({
      ...input,
      weights: { faithfulness: 0, precision: 0, similarity: 1 },
    }),
    /Invalid weights for reference-free trust score/
  );
}

function testClaimGroundingEvidenceValidation() {
  const sources = [
    {
      id: "admission_2026_section_2",
      text: "Подання заяв здійснюється до 15 серпня включно. Навчання починається у вересні.",
    },
  ];
  const valid = parseClaimGroundingResponse(JSON.stringify({
    claims: [
      {
        claim: "Термін подання заяв — до 15 серпня.",
        verdict: "supported",
        sourceIndex: 1,
        evidenceQuote: "Подання заяв здійснюється до 15 серпня включно.",
        reason: "Прямо наведено у джерелі",
      },
      {
        claim: "Термін подання заяв — до 20 серпня.",
        verdict: "contradicted",
        sourceIndex: 1,
        evidenceQuote: "Подання заяв здійснюється до 15 серпня включно.",
        reason: "У джерелі вказана інша дата",
      },
      { claim: "Є окрема стипендія.", verdict: "unsupported", reason: "Немає в контексті" },
    ],
  }), sources);
  assert.equal(valid.status, "completed");
  assert.equal(valid.counts.supported, 1);
  assert.equal(valid.counts.contradicted, 1);
  assert.equal(valid.counts.unsupported, 1);
  assert.equal(valid.claims[0].sourceId, sources[0].id);
  assert.equal(valid.claims[0].sourceIndex, 1);

  const invalid = parseClaimGroundingResponse(JSON.stringify({
    claims: [
      {
        claim: "Неіснуюча умова",
        verdict: "supported",
        sourceIndex: 2,
        evidenceQuote: "Вигадана підстава для зарахування",
      },
      {
        claim: "Ще одна умова",
        verdict: "contradicted",
        sourceIndex: 1,
        evidenceQuote: "Вигадана цитата із документа",
      },
      {
        claim: "Третя умова",
        verdict: "supported",
        sourceIndex: 1,
        evidenceQuote: "Подання",
      },
    ],
  }), sources);
  assert.equal(invalid.counts.uncertain, 3);
  assert.equal(invalid.counts.supported, 0);
  assert.equal(invalid.counts.contradicted, 0);
  for (const claim of invalid.claims) {
    assert.equal(claim.reason, "invalid_or_missing_evidence");
    assert.equal(claim.sourceId, undefined);
  }
  assert.throws(() => parseClaimGroundingResponse("invalid JSON", sources), /claim_grounding_invalid_json/);
  assert.throws(() => parseClaimGroundingResponse('{"claims":[]}', sources), /claim_grounding_invalid_claims/);
  assert.throws(() => parseClaimGroundingResponse('{"claims":[{"claim":"test","verdict":"incorrect"}]}', sources), /claim_grounding_invalid_schema/);
  const missing = unavailableClaimGrounding("no_sources_retrieved");
  assert.equal(missing.status, "unavailable");
  assert.equal(missing.counts.supported, 0);
}

function run() {
  testContextBuilder();
  testCitationExtraction();
  testFailClosedAfterCitationRetry();
  testTrustScore();
  testDocumentLevelRetrievalMetrics();
  testRecallWithDuplicateChunks();
  testFaithfulnessJudgeValidation();
  testTrustScoreWithoutGroundTruth();
  testClaimGroundingEvidenceValidation();
  console.log("Phase 3 checks passed.");
}

run();
