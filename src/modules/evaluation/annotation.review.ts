import crypto from "crypto";
import type { AnnotationQueue, AnnotationQueueCase, CandidateSource } from "./annotation.queue";
import { calculateInterAnnotatorAgreement, InterAnnotatorAgreement, TwoRaterVerdicts } from "./annotation.agreement";
import { GoldBenchmark, GoldVerdict, GoldCase, validateGoldBenchmark } from "./benchmark.gold";

const VERDICTS: ReadonlySet<string> = new Set([
  "supported", "contradicted", "unsupported", "uncertain",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(value: unknown, where: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(where + ": nonempty string required");
  }
  return value.trim();
}

function listField(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(where + ": nonempty array required");
  }
  return value;
}

function verdictField(value: unknown, where: string): GoldVerdict {
  if (typeof value !== "string" || !VERDICTS.has(value)) {
    throw new Error(where + ": invalid verdict");
  }
  return value as GoldVerdict;
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function validateDecision(
  value: unknown,
  sources: Map<string, CandidateSource>,
  where: string,
  requireRationale: boolean
): { verdict: GoldVerdict; sourceId?: string; evidenceQuote?: string; rationale?: string } {
  const decision = asRecord(value);
  if (!decision) throw new Error(where + ": decision object required");

  const verdict = verdictField(decision.verdict, where + ".verdict");
  let rationale: string | undefined;
  if (requireRationale) {
    rationale = stringField(decision.rationale, where + ".rationale");
  }
  const usesEvidence = verdict === "supported" || verdict === "contradicted";
  if (!usesEvidence) {
    if (decision.sourceId !== undefined || decision.evidenceQuote !== undefined) {
      throw new Error(where + ": evidence not allowed for unsupported/uncertain");
    }
    return { verdict, ...(rationale ? { rationale } : {}) };
  }

  const sourceId = stringField(decision.sourceId, where + ".sourceId");
  const evidenceQuote = stringField(decision.evidenceQuote, where + ".evidenceQuote");
  const source = sources.get(sourceId);
  if (!source) throw new Error(where + ": source not among reviewed queue fragments");
  if (normalizeWhitespace(evidenceQuote).length < 12 ||
      !normalizeWhitespace(source.text).includes(normalizeWhitespace(evidenceQuote))) {
    throw new Error(where + ": evidence quote missing from source");
  }
  return { verdict, sourceId, evidenceQuote, ...(rationale ? { rationale } : {}) };
}

function validateQueue(input: unknown): AnnotationQueue {
  const q = asRecord(input);
  if (!q || q.schemaVersion !== "annotation-queue/1") {
    throw new Error("queue: unsupported schemaVersion");
  }
  const corpusSnapshotId = stringField(q.corpusSnapshotId, "queue.corpusSnapshotId");
  const ingestedSha256 = stringField(q.ingestedSha256, "queue.ingestedSha256");
  if (!/^[a-f0-9]{64}$/.test(ingestedSha256) ||
      corpusSnapshotId !== "sha256:" + ingestedSha256) {
    throw new Error("queue: inconsistent corpus snapshot");
  }
  if (!/^[a-f0-9]{64}$/.test(stringField(q.queriesSha256, "queue.queriesSha256"))) {
    throw new Error("queue: invalid query hash");
  }
  stringField(q.originDatasetId, "queue.originDatasetId");

  const caseIds = new Set<string>();
  for (const [i, entry] of listField(q.cases, "queue.cases").entries()) {
    const c = asRecord(entry);
    if (!c) throw new Error("queue.cases[" + i + "]: invalid object");
    const id = stringField(c.id, "queue.cases[" + i + "].id");
    if (caseIds.has(id)) throw new Error("queue: duplicate case ID");
    caseIds.add(id);
    stringField(c.query, "queue.cases[" + i + "].query");
    if (c.status !== "needs_manual_annotation") {
      throw new Error("queue.cases[" + i + "]: unexpected status");
    }
    if (!Array.isArray(c.candidateSources)) {
      throw new Error("queue.cases[" + i + "]: candidateSources must be an array");
    }
    const sourceIds = new Set<string>();
    for (const [j, entrySource] of c.candidateSources.entries()) {
      const source = asRecord(entrySource);
      if (!source) throw new Error("queue: invalid candidate source");
      const sid = stringField(source.id, "queue source ID");
      if (sourceIds.has(sid)) throw new Error("queue: duplicate source ID in case");
      sourceIds.add(sid);
      stringField(source.documentId, "queue document ID");
      const sourceText = stringField(source.text, "queue source text");
      if (source.contentSha256 !== sha256(sourceText)) {
        throw new Error("queue: source content hash mismatch");
      }
    }
  }
  return input as AnnotationQueue;
}

export interface AdjudicationResult {
  gold: GoldBenchmark;
  agreement: InterAnnotatorAgreement;
}

/**
 * Converts manually double-rated + explicitly adjudicated claims to the
 * existing gold schema. No verdict is inferred from agreement or source text.
 * Independence and version authenticity must be checked by human reviewers.
 */
export function buildAdjudicatedGold(
  queueInput: unknown,
  reviewInput: unknown
): AdjudicationResult {
  const queue = validateQueue(queueInput);
  const review = asRecord(reviewInput);
  if (!review || review.schemaVersion !== "annotation-review/1") {
    throw new Error("review: unsupported schemaVersion");
  }

  const datasetId = stringField(review.datasetId, "review.datasetId");
  if (review.corpusSnapshotId !== queue.corpusSnapshotId ||
      review.originDatasetId !== queue.originDatasetId ||
      review.queriesSha256 !== queue.queriesSha256) {
    throw new Error("review: corpus or query snapshot mismatch");
  }
  const annotatorIds = listField(review.annotatorIds, "review.annotatorIds")
    .map(v => stringField(v, "review.annotatorId"));
  if (annotatorIds.length !== 2 || new Set(annotatorIds).size !== 2) {
    throw new Error("review: exactly two distinct annotators are required");
  }
  const adjudicatorId = stringField(review.adjudicatorId, "review.adjudicatorId");
  const queueCases = new Map(queue.cases.map(c => [c.id, c]));
  const seenCases = new Set<string>();
  const votes: TwoRaterVerdicts[] = [];
  const goldCases: GoldCase[] = [];

  for (const [i, entry] of listField(review.cases, "review.cases").entries()) {
    const item = asRecord(entry);
    if (!item) throw new Error("review.cases[" + i + "]: invalid object");
    const id = stringField(item.id, "review.cases[" + i + "].id");
    if (seenCases.has(id)) throw new Error("review: duplicate case ID");
    seenCases.add(id);
    const queueCase: AnnotationQueueCase | undefined = queueCases.get(id);
    if (!queueCase) throw new Error("review: case not present in annotation queue: " + id);
    if (item.split !== "dev" && item.split !== "test") {
      throw new Error("review.case " + id + ": split must be dev or test");
    }

    const queueSources = new Map(queueCase.candidateSources.map(s => [s.id, s]));
    const checkedSources = new Map<string, CandidateSource>();
    const goldSources: GoldCase["sources"] = [];
    for (const [j, sourceInfo] of listField(item.sourceVersions, "review sourceVersions").entries()) {
      const s = asRecord(sourceInfo);
      if (!s) throw new Error("review sourceVersions[" + j + "]: invalid object");
      const sourceId = stringField(s.sourceId, "review source ID");
      if (checkedSources.has(sourceId)) throw new Error("review: duplicate source ID");
      const fromQueue = queueSources.get(sourceId);
      if (!fromQueue) throw new Error("review: source not present in annotation queue");
      const documentVersion = stringField(s.documentVersion, "review.documentVersion");
      stringField(s.verificationNote, "review.verificationNote");
      checkedSources.set(sourceId, fromQueue);
      goldSources.push({
        id: sourceId,
        documentId: fromQueue.documentId,
        documentVersion,
        text: fromQueue.text,
      });
    }

    const seenClaims = new Set<string>();
    const goldClaims: GoldCase["claims"] = [];
    for (const [j, entryClaim] of listField(item.claims, "review.claims").entries()) {
      const c = asRecord(entryClaim);
      if (!c) throw new Error("review: invalid claim");
      const claimId = stringField(c.id, "review.claim.id");
      if (seenClaims.has(claimId)) throw new Error("review: duplicate claim ID");
      seenClaims.add(claimId);
      const claimText = stringField(c.text, "review.claim.text");
      const rawDecisions = listField(c.reviews, "review.claim.reviews");
      if (rawDecisions.length !== 2) {
        throw new Error("review: two independent decisions required for every claim");
      }
      const byAnnotator = new Map<string, GoldVerdict>();
      for (const [k, entryDecision] of rawDecisions.entries()) {
        const d = asRecord(entryDecision);
        if (!d) throw new Error("review: invalid annotator decision");
        const annotatorId = stringField(d.annotatorId, "review.annotatorId");
        if (!annotatorIds.includes(annotatorId) || byAnnotator.has(annotatorId)) {
          throw new Error("review: duplicate or unknown annotator decision");
        }
        const decision = validateDecision(d, checkedSources, "review.claim.reviews[" + k + "]", false);
        byAnnotator.set(annotatorId, decision.verdict);
      }
      if (byAnnotator.size !== 2) {
        throw new Error("review: missing annotator decision");
      }
      const adjudication = validateDecision(c.adjudication, checkedSources, "review.claim.adjudication", true);
      votes.push({
        first: byAnnotator.get(annotatorIds[0])!,
        second: byAnnotator.get(annotatorIds[1])!,
      });

      goldClaims.push({
        id: claimId,
        text: claimText,
        verdict: adjudication.verdict,
        ...(adjudication.sourceId ? { sourceId: adjudication.sourceId } : {}),
        ...(adjudication.evidenceQuote ? { evidenceQuote: adjudication.evidenceQuote } : {}),
      });
    }

    goldCases.push({
      id,
      query: queueCase.query,
      split: item.split,
      sources: goldSources,
      claims: goldClaims,
      annotatorIds: [...annotatorIds],
      adjudicatedBy: adjudicatorId,
    });
  }

  const gold: GoldBenchmark = validateGoldBenchmark({
    schemaVersion: "1.0",
    datasetId,
    corpusSnapshotId: queue.corpusSnapshotId,
    cases: goldCases,
  });
  return { gold, agreement: calculateInterAnnotatorAgreement(votes) };
}
