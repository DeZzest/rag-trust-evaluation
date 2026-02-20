import { TrustBreakdown } from "./types";

function safeNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export const TRUST_WEIGHTS = {
  faithfulness: safeNumber(process.env.TRUST_WEIGHT_FAITH, 0.4),
  precision: safeNumber(process.env.TRUST_WEIGHT_PREC, 0.3),
  similarity: safeNumber(process.env.TRUST_WEIGHT_SIM, 0.3),
};

type TrustScoreInput =
  | {
      mode: "lightweight";
      retrievalQuality: number;
      citationCoverage: number;
      citationValidity: number;
      citationInvalidAfterRetry?: boolean;
    }
  | {
      mode: "full";
      precisionAtK: number;
      faithfulnessScore: number;
      answerSimilarityToGroundTruth?: number;
      citationCoverage: number;
      citationValidity: number;
      citationInvalidAfterRetry?: boolean;
      weights?: {
        faithfulness: number;
        precision: number;
        similarity: number;
      };
    };

export function calculateTrustScore(input: TrustScoreInput): TrustBreakdown {
  if (input.mode === "lightweight") {
    const raw =
      0.6 * clamp(input.retrievalQuality) +
      0.25 * clamp(input.citationCoverage) +
      0.15 * clamp(input.citationValidity);
    let score = clamp(raw);

    if (input.citationInvalidAfterRetry) {
      score = Math.min(score, 0.35);
    }

    return {
      mode: "lightweight",
      score,
      retrievalQuality: clamp(input.retrievalQuality),
      citationCoverage: clamp(input.citationCoverage),
      citationValidity: clamp(input.citationValidity),
      cappedByCitationPolicy: Boolean(input.citationInvalidAfterRetry),
      capValue: input.citationInvalidAfterRetry ? 0.35 : undefined,
    };
  }

  const weights = input.weights ?? TRUST_WEIGHTS;
  let similarity = input.answerSimilarityToGroundTruth ?? 0.5;
  similarity = Number.isFinite(similarity) ? similarity : 0.5;

  const baseScore =
    weights.faithfulness * clamp(input.faithfulnessScore) +
    weights.precision * clamp(input.precisionAtK) +
    weights.similarity * clamp(similarity);

  const citationScore =
    0.7 * clamp(input.citationCoverage) + 0.3 * clamp(input.citationValidity);

  let combinedScore = 0.8 * baseScore + 0.2 * citationScore;
  let semanticCompensationApplied = false;

  if (input.faithfulnessScore >= 0.9 && similarity > 0.75) {
    combinedScore = Math.max(combinedScore, 0.75);
    semanticCompensationApplied = true;
  }

  let score = clamp(combinedScore);
  if (input.citationInvalidAfterRetry) {
    score = Math.min(score, 0.6);
  }

  return {
    mode: "full",
    score,
    faithfulnessScore: clamp(input.faithfulnessScore),
    precisionAtK: clamp(input.precisionAtK),
    answerSimilarityToGroundTruth: clamp(similarity),
    citationCoverage: clamp(input.citationCoverage),
    citationValidity: clamp(input.citationValidity),
    baseScore: clamp(baseScore),
    citationScore: clamp(citationScore),
    semanticCompensationApplied,
    cappedByCitationPolicy: Boolean(input.citationInvalidAfterRetry),
    capValue: input.citationInvalidAfterRetry ? 0.6 : undefined,
  };
}
