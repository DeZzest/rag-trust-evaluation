import fs from "fs";
import path from "path";
import { generateEmbedding } from "../embeddings/embedding.service";
import { getOrCreateCollection, addDocuments, similaritySearch, SearchResult } from "../vector-db/chroma.service";
import { RetrievedChunk } from "../rag/types";

const INGESTED_FILE = path.join(__dirname, "../../../data/ingested_corpus.jsonl");
const COLLECTION_NAME = process.env.CHROMA_COLLECTION ?? "lute_university_docs";

function toSafeChunkIdPart(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  return value
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9.\-]/g, "_");
}

export async function indexCorpus() {
  const collection = await getOrCreateCollection(COLLECTION_NAME);
  const lines = fs.readFileSync(INGESTED_FILE, "utf-8").split(/\r?\n/).filter(Boolean);
  const docs = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < lines.length; ++i) {
    const { text, metadata } = JSON.parse(lines[i]);
    const embedding = await generateEmbedding(text);
    // Remove null/undefined and ensure only string|number|boolean values for Chroma
    const filteredMetadata: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(metadata)) {
      if (v === null || v === undefined) continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        filteredMetadata[k] = v;
      }
    }

    const documentId = toSafeChunkIdPart(metadata.documentId, "document");
    const yearToken =
      metadata.year === null || metadata.year === undefined
        ? "na"
        : String(metadata.year);
    const sectionToken = toSafeChunkIdPart(
      metadata.subsection ?? metadata.section,
      `chunk-${i + 1}`
    );
    let id = `${documentId}_${yearToken}_${sectionToken}`;
    if (seenIds.has(id)) {
      id = `${documentId}_${yearToken}_${sectionToken}-v${i + 1}`;
    }
    seenIds.add(id);

    docs.push({
      id,
      text,
      embedding,
      metadata: filteredMetadata,
    });
    // Batch insert every 16 docs or at end
    if (docs.length === 16 || i === lines.length - 1) {
      await addDocuments(collection.id, docs);
      docs.length = 0;
    }
  }
  console.log("Indexing complete.");
}

export interface RetrievalOptions {
  year?: number;
  documentType?: string;
  topK?: number;
}

function looksLikeCollectionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

async function resolveCollectionId(collectionIdOrName: string): Promise<string> {
  if (looksLikeCollectionId(collectionIdOrName)) return collectionIdOrName;
  const collection = await getOrCreateCollection(collectionIdOrName);
  return collection.id;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractDocumentIdFromChunkId(chunkId: string): string {
  const match = chunkId.match(/^(.*)_(\d{4}|na)_(.+)$/);
  if (match) return match[1];
  return chunkId;
}

function extractDocumentYearFromChunkId(chunkId: string): number | undefined {
  const match = chunkId.match(/^(.*)_(\d{4}|na)_(.+)$/);
  if (!match) return undefined;
  if (match[2] === "na") return undefined;
  return Number(match[2]);
}

function normalizeResult(result: SearchResult): RetrievedChunk {
  const documentIdFromMetadata = toOptionalString(result.metadata?.documentId);
  const documentId = documentIdFromMetadata ?? extractDocumentIdFromChunkId(result.id);
  const documentYear =
    toOptionalNumber(result.metadata?.year) ??
    extractDocumentYearFromChunkId(result.id);
  const documentType =
    toOptionalString(result.metadata?.documentType) ??
    toOptionalString(result.metadata?.category);
  const section = toOptionalString(result.metadata?.section);
  const subsection = toOptionalString(result.metadata?.subsection);
  const confidence = Math.max(0, Math.min(1, 1 - result.distance));

  return {
    ...result,
    confidence,
    documentId,
    documentYear,
    documentType,
    section,
    subsection,
  };
}

function applyMetadataFilters(
  results: SearchResult[],
  options: RetrievalOptions
): SearchResult[] {
  let filtered = results;

  if (options.year !== undefined) {
    filtered = filtered.filter((r) => {
      const year = toOptionalNumber(r.metadata?.year);
      return year === options.year;
    });
  }

  if (options.documentType) {
    const expected = options.documentType.toLowerCase().trim();
    filtered = filtered.filter((r) => {
      const type =
        toOptionalString(r.metadata?.documentType) ??
        toOptionalString(r.metadata?.category);
      return Boolean(type && type.toLowerCase() === expected);
    });
  }

  // If year was not specified, prefer most recent year but keep yearless chunks.
  if (options.year === undefined && filtered.length > 0) {
    const withYear = filtered.filter((r) => toOptionalNumber(r.metadata?.year) !== undefined);
    const withoutYear = filtered.filter((r) => toOptionalNumber(r.metadata?.year) === undefined);

    if (withYear.length > 0) {
      const maxYear = Math.max(
        ...withYear.map((r) => Number(toOptionalNumber(r.metadata?.year)))
      );
      const latest = withYear.filter(
        (r) => toOptionalNumber(r.metadata?.year) === maxYear
      );
      filtered = latest.concat(withoutYear);
    }
  }

  return filtered;
}

export async function retrieveByEmbedding(
  collectionId: string,
  queryEmbedding: number[],
  options: RetrievalOptions = {}
): Promise<RetrievedChunk[]> {
  if (!collectionId || collectionId.trim().length === 0) {
    throw new Error("Collection ID cannot be empty");
  }

  if (!queryEmbedding || queryEmbedding.length === 0) {
    throw new Error("Query embedding cannot be empty");
  }

  const resolvedCollectionId = await resolveCollectionId(collectionId);
  const requestedTopK = options.topK ?? 5;
  const hasMetadataFilter =
    options.year !== undefined ||
    (typeof options.documentType === "string" &&
      options.documentType.trim().length > 0);
  const searchTopK = hasMetadataFilter
    ? Math.max(requestedTopK, 400)
    : requestedTopK;

  const results = await similaritySearch(
    resolvedCollectionId,
    queryEmbedding,
    searchTopK
  );
  const filtered = applyMetadataFilters(results, options);

  return filtered.slice(0, requestedTopK).map(normalizeResult);
}

export async function retrieveByCollectionId(
  collectionId: string,
  query: string,
  options: RetrievalOptions = {}
): Promise<RetrievedChunk[]> {
  const embedding = await generateEmbedding(query);
  return retrieveByEmbedding(collectionId, embedding, options);
}

export async function retrieve(
  query: string,
  options: RetrievalOptions = {}
): Promise<RetrievedChunk[]> {
  const collection = await getOrCreateCollection(COLLECTION_NAME);
  return retrieveByCollectionId(collection.id, query, options);
}

if (require.main === module) {
  indexCorpus();
}
