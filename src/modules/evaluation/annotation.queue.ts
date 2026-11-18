import crypto from "crypto";

/** Unlabeled annotation queue. This is NOT a gold-standard benchmark. */
export interface CandidateSource {
  id: string;
  documentId: string;
  declaredYear: number | null;
  section?: string;
  subsection?: string;
  sourceUrl?: string;
  text: string;
  contentSha256: string;
  ingestedLineNumber: number;
  versionVerified: false;
}

export interface AnnotationQueueCase {
  id: string;
  query: string;
  status: "needs_manual_annotation";
  expectedDocumentIds: string[];
  expectedSection?: string;
  candidateSources: CandidateSource[];
  missingDocumentIds: string[];
}

export interface AnnotationQueue {
  schemaVersion: "annotation-queue/1";
  originDatasetId: string;
  corpusSnapshotId: string;
  ingestedSha256: string;
  queriesSha256: string;
  cases: AnnotationQueueCase[];
}

interface ParsedChunk {
  source: CandidateSource;
  normalizedDocumentId: string;
  year: number | null;
}

function hash(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(label + ": nonempty text is required");
  }
  return value.trim();
}

function documentRef(raw: string): { id: string; year: number | null } {
  const fileName = raw.replace(/\\/g, "/").split("/").pop()!;
  const withoutExtension = fileName.replace(/\.txt$/i, "").toLowerCase().trim();
  const match = withoutExtension.match(/^(.*)_(\d{4})$/);
  return match
    ? { id: match[1], year: Number(match[2]) }
    : { id: withoutExtension, year: null };
}

function metadataYear(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "number" && Number.isInteger(value) && value >= 1900 && value <= 2200) {
    return value;
  }
  if (typeof value === "string" && /^\d{4}$/.test(value)) {
    return Number(value);
  }
  throw new Error(label + ": year must be a four-digit year or null");
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseChunks(jsonl: string): ParsedChunk[] {
  const lines = jsonl.split(/\r?\n/);
  const chunks: ParsedChunk[] = [];
  const seenFragments = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      throw new Error("ingested line " + (i + 1) + ": invalid JSON");
    }
    const row = record(parsed);
    const md = record(row?.metadata);
    if (!row || !md) throw new Error("ingested line " + (i + 1) + ": missing metadata");
    const body = text(row.text, "ingested line " + (i + 1) + " text");
    const docId = text(md.documentId, "ingested line " + (i + 1) + " documentId");
    const ref = documentRef(docId);
    const explicitYear = metadataYear(md.year, "ingested line " + (i + 1));
    if (ref.year !== null && explicitYear !== null && ref.year !== explicitYear) {
      throw new Error("ingested line " + (i + 1) + ": document year conflict");
    }
    const year = explicitYear ?? ref.year;
    const section = optionalText(md.section);
    const subsection = optionalText(md.subsection);
    const contentSha256 = hash(body);
    const fingerprint = hash(JSON.stringify([ref.id, year, section, subsection, body]));
    if (seenFragments.has(fingerprint)) continue;
    seenFragments.add(fingerprint);
    chunks.push({
      normalizedDocumentId: ref.id,
      year,
      source: {
        id: "fragment-" + fingerprint.slice(0, 24),
        documentId: ref.id,
        declaredYear: year,
        ...(section ? { section } : {}),
        ...(subsection ? { subsection } : {}),
        ...(optionalText(md.url) ? { sourceUrl: optionalText(md.url) } : {}),
        text: body,
        contentSha256,
        ingestedLineNumber: i + 1,
        versionVerified: false,
      },
    });
  }
  if (!chunks.length) throw new Error("ingested corpus has no valid chunks");
  return chunks;
}

/**
 * Uses existing preliminary relevantDocumentIds ONLY to suggest sources.
 * Never copies groundTruth, fabricates claims, or assigns gold labels.
 */
export function prepareAnnotationQueue(
  ingestedJsonl: string,
  queriesJson: string,
  maxPerDocument = 4
): AnnotationQueue {
  if (!Number.isInteger(maxPerDocument) || maxPerDocument < 1 || maxPerDocument > 25) {
    throw new Error("maxPerDocument must be an integer between 1 and 25");
  }
  let input: unknown;
  try {
    input = JSON.parse(queriesJson);
  } catch {
    throw new Error("evaluation queries: invalid JSON");
  }
  const root = record(input);
  if (!root || !Array.isArray(root.dataset) || root.dataset.length === 0) {
    throw new Error("evaluation queries: nonempty dataset required");
  }
  const originDatasetId = text(root.id, "evaluation dataset id");
  const chunks = parseChunks(ingestedJsonl);
  const usedCaseIds = new Set<string>();

  const cases: AnnotationQueueCase[] = root.dataset.map((entry: unknown, i: number) => {
    const q = record(entry);
    if (!q) throw new Error("evaluation query " + (i + 1) + ": invalid object");
    const id = text(q.id, "evaluation query id");
    if (usedCaseIds.has(id)) throw new Error("evaluation queries: duplicate case ID " + id);
    usedCaseIds.add(id);
    const query = text(q.query, "evaluation query " + id);
    if (!Array.isArray(q.relevantDocumentIds) || q.relevantDocumentIds.length === 0) {
      throw new Error("evaluation query " + id + ": relevantDocumentIds required");
    }
    const expectedDocumentIds = q.relevantDocumentIds.map((v: unknown) =>
      text(v, "evaluation query " + id + " document reference")
    );
    const normalizedRefs = expectedDocumentIds.map(documentRef);
    if (new Set(normalizedRefs.map(v => JSON.stringify(v))).size !== normalizedRefs.length) {
      throw new Error("evaluation query " + id + ": duplicate document reference");
    }

    const expectedSection = optionalText(q.expectedSourceSection);
    const sectionNumber = expectedSection?.match(/^Section\s+(\d+)$/i)?.[1];
    const candidateSources: CandidateSource[] = [];
    const missingDocumentIds: string[] = [];
    const seenSourceIds = new Set<string>();

    for (let j = 0; j < normalizedRefs.length; j++) {
      const target = normalizedRefs[j];
      const matching = chunks.filter(c =>
        c.normalizedDocumentId === target.id &&
        (target.year === null || c.year === target.year)
      );
      if (!matching.length) {
        missingDocumentIds.push(expectedDocumentIds[j]);
        continue;
      }
      // Section hints influence review ordering, not an assertion of relevance.
      const ranked = matching.slice().sort((a, b) => {
        const ahit = sectionNumber && a.source.section === sectionNumber ? 0 : 1;
        const bhit = sectionNumber && b.source.section === sectionNumber ? 0 : 1;
        return ahit - bhit || a.source.ingestedLineNumber - b.source.ingestedLineNumber;
      });
      for (const hit of ranked.slice(0, maxPerDocument)) {
        if (!seenSourceIds.has(hit.source.id)) {
          candidateSources.push(hit.source);
          seenSourceIds.add(hit.source.id);
        }
      }
    }

    return {
      id,
      query,
      status: "needs_manual_annotation",
      expectedDocumentIds,
      ...(expectedSection ? { expectedSection } : {}),
      candidateSources,
      missingDocumentIds,
    };
  });

  return {
    schemaVersion: "annotation-queue/1",
    originDatasetId,
    corpusSnapshotId: "sha256:" + hash(ingestedJsonl),
    ingestedSha256: hash(ingestedJsonl),
    queriesSha256: hash(queriesJson),
    cases,
  };
}
