import crypto from "crypto";

export interface DocumentQuality {
  documentId: string;
  chunks: number;
  shortUnder20: number;
  placeholders: number;
}

export interface QueueQuality {
  caseCount: number;
  candidateOccurrences: number;
  uniqueCandidateIds: number;
  repeatedCandidateOccurrences: number;
  casesWithoutCandidates: string[];
  casesOnlyPlaceholders: string[];
  casesContainingPlaceholders: string[];
  missingDocumentReferences: number;
}

export interface CorpusQualityReport {
  schemaVersion: "corpus-quality/1";
  ingestedSha256: string;
  chunkCount: number;
  documentCount: number;
  distinctTextCount: number;
  repeatedTextOccurrences: number;
  shortUnder20: number;
  shortUnder60: number;
  placeholderCount: number;
  declaredYears: Record<string, number>;
  byDocument: DocumentQuality[];
  caveat: string;
  queue?: QueueQuality;
}

const hash = (s: string) =>
  crypto.createHash("sha256").update(s, "utf8").digest("hex");

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? v as Record<string, unknown> : null;
}

function nonempty(v: unknown, field: string): string {
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(field + ": nonempty string expected");
  }
  return v.trim();
}

function isPlaceholder(s: string): boolean {
  return /^(?:no structured content extracted\.?|no text extracted\.?)$/i.test(
    s.replace(/\s+/g, " ").trim()
  );
}

export function inspectCorpusQuality(
  jsonl: string,
  queueInput?: unknown
): CorpusQualityReport {
  const lines = jsonl.split(/\r?\n/);
  const docs = new Map<string, DocumentQuality>();
  const textFingerprints = new Set<string>();
  const sourceTexts = new Map<string, Set<string>>();
  const declaredYears: Record<string, number> = {};
  let chunkCount = 0;
  let shortUnder20 = 0;
  let shortUnder60 = 0;
  let placeholderCount = 0;

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      throw new Error("corpus line " + (i + 1) + ": invalid JSON");
    }
    const row = rec(parsed);
    const metadata = rec(row?.metadata);
    if (!row || !metadata) throw new Error("corpus line " + (i + 1) + ": missing metadata");
    const text = nonempty(row.text, "corpus line " + (i + 1) + " text");
    const documentId = nonempty(metadata.documentId, "corpus line " + (i + 1) + " documentId");

    const normalized = text.replace(/\s+/g, " ").trim();
    const placeholder = isPlaceholder(normalized);
    const short20 = normalized.length < 20;
    const short60 = normalized.length < 60;
    chunkCount++;
    textFingerprints.add(hash(normalized));
    if (short20) shortUnder20++;
    if (short60) shortUnder60++;
    if (placeholder) placeholderCount++;

    const d = docs.get(documentId) ?? {
      documentId, chunks: 0, shortUnder20: 0, placeholders: 0,
    };
    d.chunks++;
    if (short20) d.shortUnder20++;
    if (placeholder) d.placeholders++;
    docs.set(documentId, d);

    const acceptedTexts = sourceTexts.get(documentId) ?? new Set<string>();
    acceptedTexts.add(hash(normalized));
    sourceTexts.set(documentId, acceptedTexts);

    const year = metadata.year;
    const yearKey = (
      typeof year === "number" && Number.isInteger(year) && year >= 1900 && year <= 2200
    ) ? String(year) : (
      typeof year === "string" && /^\d{4}$/.test(year) ? year : "unknown"
    );
    declaredYears[yearKey] = (declaredYears[yearKey] ?? 0) + 1;
  }

  if (!chunkCount) throw new Error("corpus: no usable chunks");

  const report: CorpusQualityReport = {
    schemaVersion: "corpus-quality/1",
    ingestedSha256: hash(jsonl),
    chunkCount,
    documentCount: docs.size,
    distinctTextCount: textFingerprints.size,
    repeatedTextOccurrences: chunkCount - textFingerprints.size,
    shortUnder20,
    shortUnder60,
    placeholderCount,
    declaredYears,
    byDocument: [...docs.values()].sort((a, b) =>
      b.chunks - a.chunks || a.documentId.localeCompare(b.documentId)
    ),
    caveat: "Metadata year and excerpt presence do not establish a document's true version, validity, or factual support.",
  };

  if (queueInput !== undefined) {
    const queue = rec(queueInput);
    if (!queue || queue.schemaVersion !== "annotation-queue/1") {
      throw new Error("queue: unsupported schemaVersion");
    }
    if (queue.ingestedSha256 !== hash(jsonl) ||
        queue.corpusSnapshotId !== "sha256:" + hash(jsonl)) {
      throw new Error("queue: corpus snapshot mismatch");
    }
    if (!Array.isArray(queue.cases)) throw new Error("queue: cases array required");

    const uniqueIds = new Set<string>();
    const casesWithoutCandidates: string[] = [];
    const casesOnlyPlaceholders: string[] = [];
    const casesContainingPlaceholders: string[] = [];
    let candidateOccurrences = 0;
    let missingDocumentReferences = 0;
    const caseIds = new Set<string>();

    for (const entry of queue.cases) {
      const c = rec(entry);
      if (!c) throw new Error("queue: invalid case");
      const caseId = nonempty(c.id, "queue case ID");
      if (caseIds.has(caseId)) throw new Error("queue: duplicate case ID");
      caseIds.add(caseId);
      if (!Array.isArray(c.candidateSources) ||
          !Array.isArray(c.missingDocumentIds)) {
        throw new Error("queue: missing candidateSources or missingDocumentIds");
      }
      missingDocumentReferences += c.missingDocumentIds.length;
      if (c.candidateSources.length === 0) casesWithoutCandidates.push(caseId);
      let casePlaceholders = 0;
      const perCase = new Set<string>();
      for (const entrySource of c.candidateSources) {
        const source = rec(entrySource);
        if (!source) throw new Error("queue: invalid source");
        const sourceId = nonempty(source.id, "queue source ID");
        const sourceDocumentId = nonempty(source.documentId, "queue source documentId");
        const sourceText = nonempty(source.text, "queue source text");
        const normalized = sourceText.replace(/\s+/g, " ").trim();
        if (perCase.has(sourceId)) throw new Error("queue: duplicate source ID within case");
        perCase.add(sourceId);
        if (source.contentSha256 !== hash(sourceText) ||
            !sourceTexts.get(sourceDocumentId)?.has(hash(normalized))) {
          throw new Error("queue: source content not found in ingested corpus");
        }
        candidateOccurrences++;
        uniqueIds.add(sourceId);
        if (isPlaceholder(normalized)) casePlaceholders++;
      }
      if (casePlaceholders > 0) casesContainingPlaceholders.push(caseId);
      if (casePlaceholders > 0 && casePlaceholders === c.candidateSources.length) {
        casesOnlyPlaceholders.push(caseId);
      }
    }
    report.queue = {
      caseCount: queue.cases.length,
      candidateOccurrences,
      uniqueCandidateIds: uniqueIds.size,
      repeatedCandidateOccurrences: candidateOccurrences - uniqueIds.size,
      casesWithoutCandidates,
      casesOnlyPlaceholders,
      casesContainingPlaceholders,
      missingDocumentReferences,
    };
  }
  return report;
}
