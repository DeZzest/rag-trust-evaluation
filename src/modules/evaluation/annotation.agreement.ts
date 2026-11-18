import type { GoldVerdict } from "./benchmark.gold";

export interface TwoRaterVerdicts {
  first: GoldVerdict;
  second: GoldVerdict;
}

export interface InterAnnotatorAgreement {
  claimCount: number;
  agreements: number;
  disagreements: number;
  observedAgreement: number;
  expectedAgreement: number;
  cohenKappa: number | null;
  rater1Distribution: Record<GoldVerdict, number>;
  rater2Distribution: Record<GoldVerdict, number>;
}

const VERDICTS: GoldVerdict[] = [
  "supported", "contradicted", "unsupported", "uncertain",
];

/** Cohen's kappa for exactly two raters, evaluated BEFORE adjudication. */
export function calculateInterAnnotatorAgreement(
  votes: TwoRaterVerdicts[]
): InterAnnotatorAgreement {
  if (!Array.isArray(votes) || votes.length === 0) {
    throw new Error("agreement: at least one double-rated claim is required");
  }
  const firstCounts = {} as Record<GoldVerdict, number>;
  const secondCounts = {} as Record<GoldVerdict, number>;
  for (const verdict of VERDICTS) {
    firstCounts[verdict] = 0;
    secondCounts[verdict] = 0;
  }

  let agreements = 0;
  for (const vote of votes) {
    if (!vote || !VERDICTS.includes(vote.first) || !VERDICTS.includes(vote.second)) {
      throw new Error("agreement: invalid verdict");
    }
    firstCounts[vote.first]++;
    secondCounts[vote.second]++;
    if (vote.first === vote.second) agreements++;
  }
  const claimCount = votes.length;
  const observedAgreement = agreements / claimCount;
  const expectedAgreement = VERDICTS.reduce(
    (sum, label) => sum + (firstCounts[label] / claimCount) * (secondCounts[label] / claimCount),
    0
  );

  // The ratio is undefined when both raters select a single identical label
  // on every item (the denominator is zero). A null is NOT perfect kappa.
  const cohenKappa = (1 - expectedAgreement) <= 1e-12
    ? null
    : (observedAgreement - expectedAgreement) / (1 - expectedAgreement);

  return {
    claimCount,
    agreements,
    disagreements: claimCount - agreements,
    observedAgreement,
    expectedAgreement,
    cohenKappa,
    rater1Distribution: firstCounts,
    rater2Distribution: secondCounts,
  };
}
