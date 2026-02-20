import { CitationValidationResult } from "./types";

const CITATION_REGEX = /\[(\d+)\]/g;
const MIN_FACTUAL_SENTENCE_LENGTH = 20;
const COVERAGE_THRESHOLD = 0.8;

function splitSentences(answer: string): string[] {
  return answer
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function isFactualSentence(sentence: string): boolean {
  if (sentence.length < MIN_FACTUAL_SENTENCE_LENGTH) {
    return false;
  }
  return /[\p{L}\p{N}]/u.test(sentence);
}

export function extractAndValidateCitations(
  answer: string,
  sourceCount: number
): CitationValidationResult {
  const citations: number[] = [];
  CITATION_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null = CITATION_REGEX.exec(answer);

  while (match) {
    const citation = Number(match[1]);
    if (Number.isFinite(citation)) {
      citations.push(citation);
    }
    match = CITATION_REGEX.exec(answer);
  }

  const uniqueCitations = Array.from(new Set(citations)).sort((a, b) => a - b);
  const invalidCitations = uniqueCitations.filter(
    (c) => c < 1 || c > sourceCount
  );
  const hasCitations = uniqueCitations.length > 0;

  const factualSentences = splitSentences(answer).filter(isFactualSentence);
  const citedSentenceCount = factualSentences.filter((s) =>
    /\[(\d+)\]/.test(s)
  ).length;
  const factualSentenceCount = factualSentences.length;
  const missingCitationSentenceCount = Math.max(
    factualSentenceCount - citedSentenceCount,
    0
  );
  const coverage =
    factualSentenceCount > 0 ? citedSentenceCount / factualSentenceCount : 0;

  const citationValidity =
    hasCitations && invalidCitations.length === 0 ? 1 : 0;

  const issues: string[] = [];
  if (!hasCitations) {
    issues.push("missing_citations");
  }
  if (invalidCitations.length > 0) {
    issues.push("invalid_reference_indices");
  }
  if (coverage < COVERAGE_THRESHOLD) {
    issues.push("insufficient_citation_coverage");
  }

  return {
    citations,
    uniqueCitations,
    invalidCitations,
    hasCitations,
    factualSentenceCount,
    citedSentenceCount,
    missingCitationSentenceCount,
    coverage,
    citationValidity,
    isValid:
      hasCitations &&
      invalidCitations.length === 0 &&
      coverage >= COVERAGE_THRESHOLD,
    retryCount: 0,
    issues,
  };
}
