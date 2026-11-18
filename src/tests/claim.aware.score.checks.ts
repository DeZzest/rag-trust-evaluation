import assert from "assert/strict";
import { parseClaimGroundingResponse, unavailableClaimGrounding } from "../modules/evaluation/claim.grounding";
import type { ClaimGroundingResult } from "../modules/evaluation/claim.grounding";
import {
  calculateClaimAwareTrust,
  CLAIM_AWARE_CAPS,
  CLAIM_AWARE_WEIGHTS,
  unavailableClaimAwareTrust,
} from "../modules/rag/claim.aware.score";

// Fictional test text and judgments. Not a real RAG/gold evaluation.
const SOURCE = {
  id: "synthetic-document-chunk",
  text: "Умовний документ встановлює порядок подання заяв до 15 серпня.",
};
const QUOTE = "порядок подання заяв до 15 серпня";

function judgments(verdicts: Array<"supported" | "contradicted" | "unsupported" | "uncertain">): ClaimGroundingResult {
  const claims = verdicts.map((verdict, i) => ({
    claim: "Штучне твердження " + (i + 1),
    verdict,
    reason: "Synthetic fixture, not a legal assertion",
    ...(["supported", "contradicted"].includes(verdict)
      ? { sourceIndex: 1, evidenceQuote: QUOTE } : {}),
  }));
  return parseClaimGroundingResponse(JSON.stringify({ claims }), [SOURCE]);
}

function almost(actual: number | null, expected: number): void {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual! - expected) < 1e-12,
    "Expected " + expected + "; got " + actual);
}

function testPairedScoring(): void {
  const allSupported = calculateClaimAwareTrust(.8, judgments(["supported", "supported"]));
  assert.equal(allSupported.methodId, "claim-aware-v1");
  assert.equal(allSupported.status, "completed");
  assert.equal(allSupported.baselineScore, .8);
  assert.equal(allSupported.totalClaims, 2);
  assert.equal(allSupported.supportedFraction, 1);
  almost(allSupported.score, .65 * .8 + .35);
  assert.equal(allSupported.capValue, null);
  assert.deepEqual(allSupported.capReasons, []);
  almost(CLAIM_AWARE_WEIGHTS.baseline + CLAIM_AWARE_WEIGHTS.supportedFraction, 1);

  const contradicted = calculateClaimAwareTrust(1, judgments(["supported", "contradicted"]));
  assert.equal(contradicted.supportedFraction, .5);
  almost(contradicted.uncappedScore, .65 + .35 * .5);
  almost(contradicted.score, CLAIM_AWARE_CAPS.contradicted);
  assert.deepEqual(contradicted.capReasons, ["contradicted"]);

  const unsupported = calculateClaimAwareTrust(1, judgments(["unsupported"]));
  almost(unsupported.score, CLAIM_AWARE_CAPS.unsupported);

  const uncertain = calculateClaimAwareTrust(1, judgments(["uncertain"]));
  almost(uncertain.score, .65); // under the cap of 0.70
  assert.equal(uncertain.capValue, CLAIM_AWARE_CAPS.uncertain);
  const mixed = calculateClaimAwareTrust(1, judgments([
    "uncertain", "unsupported", "contradicted", "supported"
  ]));
  assert.deepEqual(mixed.capReasons, ["contradicted", "unsupported", "uncertain"]);
  almost(mixed.score, .25);

  const low = calculateClaimAwareTrust(0, judgments(["uncertain"]));
  almost(low.score, 0);
  assert.equal(low.baselineScore, 0);
}

function testUnavailableAndNoImputation(): void {
  const missing = calculateClaimAwareTrust(
    0.8, unavailableClaimGrounding("synthetic_model_failure")
  );
  assert.equal(missing.status, "unavailable");
  assert.equal(missing.baselineScore, 0.8);
  assert.equal(missing.score, null);
  assert.equal(missing.supportedFraction, null);
  assert.equal(missing.capValue, null);
  assert.equal(missing.issue, "synthetic_model_failure");

  const empty = calculateClaimAwareTrust(0.1, {
    status: "completed",
    claims: [],
    counts: { supported: 0, contradicted: 0, unsupported: 0, uncertain: 0 },
  });
  assert.equal(empty.score, null);
  assert.equal(empty.status, "unavailable");
  assert.equal(empty.issue, "no_classified_claims");

  const noSources = unavailableClaimAwareTrust(0, "no_sources_retrieved");
  assert.equal(noSources.score, null);
  assert.equal(noSources.baselineScore, 0);
  assert.equal(noSources.issue, "no_sources_retrieved");
}

function testStrictInputAndEvidence(): void {
  const valid = judgments(["supported", "unsupported"]);
  assert.throws(() => calculateClaimAwareTrust(Number.NaN, valid), /baseline/);
  assert.throws(() => calculateClaimAwareTrust(-.1, valid), /baseline/);
  assert.throws(() => calculateClaimAwareTrust(1.1, valid), /baseline/);
  assert.throws(() => calculateClaimAwareTrust(.7, {
    ...valid, counts: { ...valid.counts, supported: 2 }
  }), /inconsistent verdict counts/);
  assert.throws(() => calculateClaimAwareTrust(.7, {
    ...valid, claims: valid.claims.map((c, i) =>
      i === 0 ? { ...c, evidenceQuote: "" } : c)
  }), /lacks quoted source evidence/);

  // Invalid source quotes cannot be treated as semantic confirmation.
  const invalidQuote = parseClaimGroundingResponse(JSON.stringify({
    claims: [{claim: "Фіктивне твердження", verdict: "supported",
      sourceIndex: 1, evidenceQuote: "ніколи не згаданий фрагмент", reason: "fictional"}],
  }), [SOURCE]);
  assert.equal(invalidQuote.counts.supported, 0);
  assert.equal(invalidQuote.counts.uncertain, 1);
  const guarded = calculateClaimAwareTrust(1, invalidQuote);
  assert.equal(guarded.status, "completed");
  almost(guarded.score, .65);
  assert.ok(guarded.disclaimer.includes("not semantic entailment"));
}

testPairedScoring();
testUnavailableAndNoImputation();
testStrictInputAndEvidence();
console.log("Claim-aware Trust Score candidate checks passed (synthetic, no real gold).");
