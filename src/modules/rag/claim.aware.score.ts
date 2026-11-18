import type { ClaimGroundingResult, ClaimVerdict } from "../evaluation/claim.grounding";

/**
 * Fixed research candidate v1. It is NOT an empirical accuracy estimate.
 *
 * Keep the historical lightweight trust score unchanged and expose this
 * experimental, claim-sensitive score next to it for paired comparisons.
 */
export interface ClaimAwareTrustComparison {
  status: "completed" | "unavailable";
  methodId: "claim-aware-v1";
  baselineScore: number;
  score: number | null;
  totalClaims: number;
  counts: Record<ClaimVerdict, number>;
  supportedFraction: number | null;
  uncappedScore: number | null;
  capValue: number | null;
  capReasons: ClaimVerdict[];
  issue?: string;
  disclaimer: string;
}

const VERDICTS: ClaimVerdict[] = [
  "supported", "contradicted", "unsupported", "uncertain",
];

export const CLAIM_AWARE_WEIGHTS = {
  baseline: 0.65,
  supportedFraction: 0.35,
} as const;

/** Maximum claim-aware result allowed after ANY verdict of the given type. */
export const CLAIM_AWARE_CAPS = {
  contradicted: 0.25,
  unsupported: 0.5,
  uncertain: 0.7,
} as const;

const DISCLAIMER =
  "Experimental score based on LLM-proposed claim verdicts. " +
  "Exact evidence quote matching is not semantic entailment. " +
  "The result is not a probability of truth or a gold-label measurement.";

function invalidBaseline(value: number): boolean {
  return typeof value !== "number" ||
    !Number.isFinite(value) || value < 0 || value > 1;
}

function verifyVerdicts(result: ClaimGroundingResult): number {
  if (!Array.isArray(result.claims) || !result.counts) {
    throw new Error("claim-aware: missing claim verdicts or counts");
  }
  const expected: Record<ClaimVerdict, number> = {
    supported: 0, contradicted: 0, unsupported: 0, uncertain: 0,
  };
  for (const claim of result.claims) {
    if (!claim || !VERDICTS.includes(claim.verdict)) {
      throw new Error("claim-aware: invalid claim verdict");
    }
    if ((claim.verdict === "supported" || claim.verdict === "contradicted") &&
        (typeof claim.sourceId !== "string" || !claim.sourceId.trim() ||
         !Number.isInteger(claim.sourceIndex) || (claim.sourceIndex ?? 0) < 1 ||
         typeof claim.evidenceQuote !== "string" ||
         claim.evidenceQuote.replace(/\s+/g, " ").trim().length < 12)) {
      throw new Error("claim-aware: supported/contradicted verdict lacks quoted source evidence");
    }
    expected[claim.verdict]++;
  }
  for (const verdict of VERDICTS) {
    if (!Number.isInteger(result.counts[verdict]) ||
        result.counts[verdict] !== expected[verdict]) {
      throw new Error("claim-aware: inconsistent verdict counts");
    }
  }
  return result.claims.length;
}

/**
 * No imputation: unavailable / empty claim classification => score:null.
 * Missing classifications cannot silently become "supported" or "uncertain".
 */
export function calculateClaimAwareTrust(
  baselineScore: number,
  result: ClaimGroundingResult
): ClaimAwareTrustComparison {
  if (invalidBaseline(baselineScore)) {
    throw new Error("claim-aware: baseline must be a finite score in [0,1]");
  }
  if (!result || !["completed", "unavailable"].includes(result.status)) {
    throw new Error("claim-aware: invalid grounding status");
  }
  const totalClaims = verifyVerdicts(result);
  const common = {
    methodId: "claim-aware-v1" as const,
    baselineScore,
    totalClaims,
    counts: { ...result.counts },
    disclaimer: DISCLAIMER,
  };
  if (result.status === "unavailable" || totalClaims === 0) {
    return {
      ...common,
      status: "unavailable",
      score: null,
      supportedFraction: null,
      uncappedScore: null,
      capValue: null,
      capReasons: [],
      issue: result.issue ?? (totalClaims === 0 ? "no_classified_claims" : "claim_grounding_unavailable"),
    };
  }

  const supportedFraction = result.counts.supported / totalClaims;
  const uncappedScore =
    CLAIM_AWARE_WEIGHTS.baseline * baselineScore +
    CLAIM_AWARE_WEIGHTS.supportedFraction * supportedFraction;

  const capReasons: ClaimVerdict[] = [];
  if (result.counts.contradicted > 0) capReasons.push("contradicted");
  if (result.counts.unsupported > 0) capReasons.push("unsupported");
  if (result.counts.uncertain > 0) capReasons.push("uncertain");

  const caps = capReasons.map(verdict => {
    if (verdict === "supported") throw new Error("claim-aware: impossible cap");
    return CLAIM_AWARE_CAPS[verdict];
  });
  const capValue = caps.length > 0 ? Math.min(...caps) : null;
  const score = Math.max(0, Math.min(1,
    capValue === null ? uncappedScore : Math.min(uncappedScore, capValue)
  ));

  return {
    ...common,
    status: "completed",
    score,
    supportedFraction,
    uncappedScore,
    capValue,
    capReasons,
  };
}

export function unavailableClaimAwareTrust(
  baselineScore: number,
  issue: string
): ClaimAwareTrustComparison {
  if (invalidBaseline(baselineScore)) {
    throw new Error("claim-aware: invalid baseline score");
  }
  return {
    methodId: "claim-aware-v1",
    status: "unavailable",
    baselineScore,
    score: null,
    totalClaims: 0,
    counts: { supported: 0, contradicted: 0, unsupported: 0, uncertain: 0 },
    supportedFraction: null,
    uncappedScore: null,
    capValue: null,
    capReasons: [],
    issue,
    disclaimer: DISCLAIMER,
  };
}
