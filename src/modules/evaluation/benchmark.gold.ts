export type GoldVerdict = "supported" | "contradicted" | "unsupported" | "uncertain";

export interface GoldSource {
  id: string;
  documentId: string;
  documentVersion: string;
  text: string;
}

export interface GoldClaim {
  id: string;
  text: string;
  verdict: GoldVerdict;
  sourceId?: string;
  evidenceQuote?: string;
}

export interface GoldCase {
  id: string;
  query: string;
  split: "dev" | "test";
  sources: GoldSource[];
  claims: GoldClaim[];
  annotatorIds: string[];
  adjudicatedBy: string;
}

export interface GoldBenchmark {
  schemaVersion: "1.0";
  datasetId: string;
  corpusSnapshotId: string;
  cases: GoldCase[];
}

const VERDICTS: ReadonlySet<string> = new Set([
  "supported", "contradicted", "unsupported", "uncertain",
]);

const hasText = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requireText(value: unknown, path: string): string {
  if (!hasText(value)) throw new Error(`${path}: required nonempty text`);
  return value;
}

function uniqueIds(ids: string[], path: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${path}: duplicate identifiers`);
  }
}

function normalized(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Syntactic and provenance validation only. This does not confirm that an
 * annotator's semantic judgment is correct.
 */
export function validateGoldBenchmark(input: unknown): GoldBenchmark {
  const root = object(input);
  if (!root || root.schemaVersion !== "1.0") {
    throw new Error("gold: unsupported schemaVersion");
  }
  requireText(root.datasetId, "datasetId");
  requireText(root.corpusSnapshotId, "corpusSnapshotId");
  if (!Array.isArray(root.cases) || root.cases.length === 0) {
    throw new Error("cases: nonempty array required");
  }

  const caseIds: string[] = [];
  for (const [i, entry] of root.cases.entries()) {
    const c = object(entry);
    if (!c) throw new Error(`cases[${i}]: invalid object`);
    caseIds.push(requireText(c.id, `cases[${i}].id`));
    requireText(c.query, `cases[${i}].query`);
    if (c.split !== "dev" && c.split !== "test") {
      throw new Error(`cases[${i}].split: expected dev or test`);
    }

    if (!Array.isArray(c.annotatorIds) ||
        c.annotatorIds.length < 2 ||
        !c.annotatorIds.every(hasText)) {
      throw new Error(`cases[${i}].annotatorIds: at least two annotators required`);
    }
    uniqueIds(c.annotatorIds, `cases[${i}].annotatorIds`);
    requireText(c.adjudicatedBy, `cases[${i}].adjudicatedBy`);

    if (!Array.isArray(c.sources) || c.sources.length === 0) {
      throw new Error(`cases[${i}].sources: nonempty array required`);
    }
    const sourceIds: string[] = [];
    const sources = new Map<string, string>();
    for (const [j, entrySource] of c.sources.entries()) {
      const source = object(entrySource);
      if (!source) throw new Error(`cases[${i}].sources[${j}]: invalid object`);
      const id = requireText(source.id, `cases[${i}].sources[${j}].id`);
      sourceIds.push(id);
      requireText(source.documentId, `cases[${i}].sources[${j}].documentId`);
      requireText(source.documentVersion, `cases[${i}].sources[${j}].documentVersion`);
      sources.set(id, requireText(source.text, `cases[${i}].sources[${j}].text`));
    }
    uniqueIds(sourceIds, `cases[${i}].sources`);

    if (!Array.isArray(c.claims) || c.claims.length === 0) {
      throw new Error(`cases[${i}].claims: nonempty array required`);
    }
    const claimIds: string[] = [];
    for (const [j, entryClaim] of c.claims.entries()) {
      const claim = object(entryClaim);
      if (!claim) throw new Error(`cases[${i}].claims[${j}]: invalid object`);
      claimIds.push(requireText(claim.id, `cases[${i}].claims[${j}].id`));
      requireText(claim.text, `cases[${i}].claims[${j}].text`);
      if (typeof claim.verdict !== "string" || !VERDICTS.has(claim.verdict)) {
        throw new Error(`cases[${i}].claims[${j}].verdict: invalid verdict`);
      }
      const requiresEvidence = claim.verdict === "supported" || claim.verdict === "contradicted";
      if (requiresEvidence) {
        const sourceId = requireText(claim.sourceId, `cases[${i}].claims[${j}].sourceId`);
        const quote = requireText(claim.evidenceQuote, `cases[${i}].claims[${j}].evidenceQuote`);
        const sourceText = sources.get(sourceId);
        if (!sourceText || normalized(quote).length < 12 ||
            !normalized(sourceText).includes(normalized(quote))) {
          throw new Error(`cases[${i}].claims[${j}]: source evidence not found`);
        }
      } else if (claim.sourceId !== undefined || claim.evidenceQuote !== undefined) {
        throw new Error(`cases[${i}].claims[${j}]: evidence allowed only for supported/contradicted`);
      }
    }
    uniqueIds(claimIds, `cases[${i}].claims`);
  }
  uniqueIds(caseIds, "cases");
  return input as GoldBenchmark;
}
