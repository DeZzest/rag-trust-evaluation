import crypto from "crypto";
import type { AnnotationQueue } from "./annotation.queue";

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? v as Record<string, unknown>
    : null;
}

function nonempty(v: unknown, label: string): string {
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(label + ": nonempty string required");
  }
  return v.trim();
}

export interface CorpusReadinessReport {
  schemaVersion: "corpus-readiness/1";
  corpusSha256: string;
  totalChunks: number;
  distinctDocumentIds: number;
  distinctSourceUrls: number;
  declaredYearCounts: Record<string, number>;
  shortChunksUnder30: number;
  shortChunkRate: number;
  exactDuplicateTexts: number;
  pdfDerivedChunks: number;
  pdfDerivedDocumentIds: number;
  queue: {
    caseCount: number;
    casesWithoutCandidates: number;
    missingDocumentReferences: number;
    sourceAssignments: number;
    distinctCandidateSourceIds: number;
    reusedCandidateSourceIds: number;
    candidateUniquenessRatio: number;
    candidateCoverageOfCorpus: number;
  };
  warnings: string[];
}

/**
 * Diagnostic report of source coverage, not factual accuracy or benchmark
 * validity. All year values below are unverified declared metadata.
 */
export function auditCorpusReadiness(
  ingestedJsonl: string,
  queueInput: unknown
): CorpusReadinessReport {
  const queue = record(queueInput);
  if (!queue || queue.schemaVersion !== "annotation-queue/1") {
    throw new Error("readiness: invalid annotation queue schema");
  }
  const expectedHash = sha256(ingestedJsonl);
  if (queue.ingestedSha256 !== expectedHash ||
      queue.corpusSnapshotId !== "sha256:" + expectedHash) {
    throw new Error("readiness: corpus snapshot SHA-256 mismatch");
  }

  const rows = ingestedJsonl.split(/\r?\n/).filter(s => s.trim());
  if (rows.length === 0) throw new Error("readiness: empty corpus");

  const docIds = new Set<string>();
  const urls = new Set<string>();
  const pdfDocIds = new Set<string>();
  const textCounts = new Map<string, number>();
  const yearCounts: Record<string, number> = {};
  let shortChunksUnder30 = 0;
  let pdfDerivedChunks = 0;

  for (let i = 0; i < rows.length; i++) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rows[i]);
    } catch {
      throw new Error("readiness: invalid JSONL record at line " + (i + 1));
    }
    const row = record(parsed);
    const md = record(row?.metadata);
    if (!md) throw new Error("readiness: missing metadata at line " + (i + 1));
    const docId = nonempty(md.documentId, "readiness.documentId");
    const body = nonempty(row?.text, "readiness.text");
    docIds.add(docId);
    if (typeof md.url === "string" && md.url.trim()) urls.add(md.url.trim());
    const year = md.year === null || md.year === undefined
      ? "unknown"
      : String(md.year);
    if (year !== "unknown" && !/^\d{4}$/.test(year)) {
      throw new Error("readiness: invalid declared year at line " + (i + 1));
    }
    yearCounts[year] = (yearCounts[year] ?? 0) + 1;
    if (body.length < 30) shortChunksUnder30++;
    textCounts.set(body, (textCounts.get(body) ?? 0) + 1);
    if (/_pdf_\d+$/i.test(docId)) {
      pdfDerivedChunks++;
      pdfDocIds.add(docId);
    }
  }

  if (!Array.isArray(queue.cases) || queue.cases.length === 0) {
    throw new Error("readiness: queue has no cases");
  }

  const queueCaseIds = new Set<string>();
  const sourceCounts = new Map<string, number>();
  let sourceAssignments = 0;
  let casesWithoutCandidates = 0;
  let missingDocumentReferences = 0;

  for (const [i, rawCase] of queue.cases.entries()) {
    const item = record(rawCase);
    if (!item) throw new Error("readiness: invalid queue case");
    const id = nonempty(item.id, "readiness.case.id");
    if (queueCaseIds.has(id)) throw new Error("readiness: duplicate case ID");
    queueCaseIds.add(id);
    if (!Array.isArray(item.candidateSources) ||
        !Array.isArray(item.missingDocumentIds)) {
      throw new Error("readiness: invalid queue candidate/missing arrays at case " + i);
    }
    if (item.candidateSources.length === 0) casesWithoutCandidates++;
    missingDocumentReferences += item.missingDocumentIds.length;
    const localSourceIds = new Set<string>();
    for (const rawCandidate of item.candidateSources) {
      const s = record(rawCandidate);
      if (!s) throw new Error("readiness: invalid candidate");
      const sourceId = nonempty(s.id, "readiness.candidate.id");
      const body = nonempty(s.text, "readiness.candidate.text");
      if (s.contentSha256 !== sha256(body)) {
        throw new Error("readiness: candidate content hash mismatch");
      }
      if (localSourceIds.has(sourceId)) {
        throw new Error("readiness: duplicate candidate ID in one case");
      }
      localSourceIds.add(sourceId);
      if (!textCounts.has(body)) {
        throw new Error("readiness: candidate source not present in corpus");
      }
      sourceCounts.set(sourceId, (sourceCounts.get(sourceId) ?? 0) + 1);
      sourceAssignments++;
    }
  }

  const totalChunks = rows.length;
  const distinctCandidateSourceIds = sourceCounts.size;
  const candidateUniquenessRatio = sourceAssignments > 0
    ? distinctCandidateSourceIds / sourceAssignments
    : 0;
  const shortChunkRate = shortChunksUnder30 / totalChunks;
  const warnings: string[] = [];
  if (shortChunkRate >= 0.2) warnings.push("short_chunk_rate_ge_20_percent");
  if (sourceAssignments > 0 && candidateUniquenessRatio < 0.5) {
    warnings.push("candidate_source_reuse_high");
  }
  if (casesWithoutCandidates > 0) warnings.push("cases_without_candidate_sources");
  if (new Set(Object.keys(yearCounts)).size === 1) {
    warnings.push("single_declared_year_check_document_version_authenticity");
  }
  if (pdfDerivedChunks > 0) {
    warnings.push("pdf_derived_documents_require_review_of_provenance");
  }

  return {
    schemaVersion: "corpus-readiness/1",
    corpusSha256: expectedHash,
    totalChunks,
    distinctDocumentIds: docIds.size,
    distinctSourceUrls: urls.size,
    declaredYearCounts: yearCounts,
    shortChunksUnder30,
    shortChunkRate,
    exactDuplicateTexts: [...textCounts.values()].reduce((n, v) => n + Math.max(0, v - 1), 0),
    pdfDerivedChunks,
    pdfDerivedDocumentIds: pdfDocIds.size,
    queue: {
      caseCount: queue.cases.length,
      casesWithoutCandidates,
      missingDocumentReferences,
      sourceAssignments,
      distinctCandidateSourceIds,
      reusedCandidateSourceIds: [...sourceCounts.values()].filter(v => v > 1).length,
      candidateUniquenessRatio,
      candidateCoverageOfCorpus: distinctCandidateSourceIds / totalChunks,
    },
    warnings,
  };
}
