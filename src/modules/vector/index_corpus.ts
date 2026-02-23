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
  queryText?: string;
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "with",
  "that",
  "this",
  "from",
  "what",
  "how",
  "можна",
  "треба",
  "щодо",
  "для",
  "про",
  "які",
  "який",
  "так",
  "де",
  "чи",
  "та",
  "і",
  "в",
  "на",
  "до",
  "з",
]);

function normalizeForTokens(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-zа-яіїєґ0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(input: string): string[] {
  if (!input) return [];
  const normalized = normalizeForTokens(input);
  if (!normalized) return [];
  const tokens = normalized
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
  return Array.from(new Set(tokens));
}

function containsAny(normalizedText: string, terms: string[]): boolean {
  return terms.some((term) => normalizedText.includes(term));
}

function inferPreferredCategories(queryText?: string): string[] {
  if (!queryText) return [];
  const q = normalizeForTokens(queryText);
  if (!q) return [];

  const categories: string[] = [];
  const add = (category: string) => {
    if (!categories.includes(category)) categories.push(category);
  };

  const hasAdmissionIntent = containsAny(q, [
    "вступ",
    "прийом",
    "абітур",
    "зарахув",
    "admission",
    "applicant",
    "enroll",
  ]);
  const hasDocumentIntent = containsAny(q, [
    "документ",
    "довідк",
    "сертиф",
    "паспорт",
    "document",
    "certificate",
    "passport",
    "required",
  ]);
  if (hasAdmissionIntent && hasDocumentIntent) add("admission_documents");
  if (hasAdmissionIntent) add("admission");
  if (hasDocumentIntent && !hasAdmissionIntent) add("regulations");

  if (
    containsAny(q, [
      "академічн",
      "доброчес",
      "plagiarism",
      "integrity",
      "етик",
      "cheating",
    ])
  ) {
    add("academic_integrity");
  }

  if (containsAny(q, ["стипенд", "scholarship", "грант", "grant"])) {
    add("scholarship");
  }

  if (
    containsAny(q, [
      "матеріаль",
      "технічн",
      "material base",
      "infrastructure",
      "base",
    ])
  ) {
    add("material_base");
  }

  if (
    containsAny(q, [
      "положен",
      "регламент",
      "норматив",
      "rule",
      "regulation",
      "policy",
    ])
  ) {
    add("regulations");
  }

  return categories;
}

function hasCyrillic(text: string): boolean {
  return /[а-яіїєґ]/i.test(text);
}

export function expandQueryForCorpus(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return trimmed;
  if (hasCyrillic(trimmed)) return trimmed;

  const normalized = trimmed.toLowerCase();
  const hints: string[] = [];
  const addHint = (hint: string) => {
    if (!hints.includes(hint)) hints.push(hint);
  };

  if (/(admission|applicant|enroll|entry|entrance)/.test(normalized)) {
    addHint("вступ");
    addHint("правила прийому");
  }
  if (/(document|required|certificate|passport|application)/.test(normalized)) {
    addHint("документи для вступу");
    addHint("необхідні документи");
  }
  if (/(integrity|plagiarism|cheating|ethics)/.test(normalized)) {
    addHint("академічна доброчесність");
  }
  if (/(scholarship|grant|funding)/.test(normalized)) {
    addHint("стипендія");
    addHint("грант");
  }
  if (/(material base|infrastructure|facilities|campus)/.test(normalized)) {
    addHint("матеріально-технічна база");
  }
  if (/(regulation|policy|normative|rules)/.test(normalized)) {
    addHint("нормативні документи");
    addHint("положення");
  }

  if (hints.length === 0) return trimmed;
  return `${trimmed}\n\nUkrainian retrieval hints: ${hints.join("; ")}`;
}

function getResultCategory(result: SearchResult): string | undefined {
  return (
    toOptionalString(result.metadata?.category) ??
    toOptionalString(result.metadata?.documentType)
  );
}

function lexicalOverlapScore(
  queryTokens: string[],
  result: SearchResult
): number {
  if (queryTokens.length === 0) return 0;

  const queryTokenSet = new Set(queryTokens);
  const textSample = [
    result.text.slice(0, 900),
    toOptionalString(result.metadata?.title),
    toOptionalString(result.metadata?.documentTitle),
    toOptionalString(result.metadata?.section),
    toOptionalString(result.metadata?.subsection),
  ]
    .filter(Boolean)
    .join(" ");

  const resultTokens = new Set(tokenize(textSample));
  if (resultTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of queryTokenSet) {
    if (resultTokens.has(token)) overlap++;
  }

  return overlap / queryTokenSet.size;
}

function rerankResults(results: SearchResult[], options: RetrievalOptions): SearchResult[] {
  const queryText = options.queryText?.trim();
  if (!queryText) return results;

  const queryTokens = tokenize(queryText);
  const preferredCategories = inferPreferredCategories(queryText);
  const rankByCategory = new Map<string, number>();
  preferredCategories.forEach((category, index) => {
    rankByCategory.set(category, index);
  });

  const ranked = results.map((result, index) => {
    const semantic = clamp(1 - result.distance, 0, 1);
    const lexical = lexicalOverlapScore(queryTokens, result);

    const category = getResultCategory(result)?.toLowerCase();
    const categoryRank =
      category !== undefined ? rankByCategory.get(category) : undefined;
    let categoryBoost = 0;
    if (categoryRank !== undefined) {
      categoryBoost = Math.max(0.14, 0.28 - categoryRank * 0.06);
    }

    const score = semantic * 0.74 + lexical * 0.26 + categoryBoost;
    return {
      result,
      score,
      fallbackDistance: result.distance,
      originalIndex: index,
    };
  });

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.fallbackDistance !== b.fallbackDistance) {
      return a.fallbackDistance - b.fallbackDistance;
    }
    return a.originalIndex - b.originalIndex;
  });

  return ranked.map((item) => item.result);
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
  const hasQueryText =
    typeof options.queryText === "string" &&
    options.queryText.trim().length > 0;
  const searchTopKBase = hasMetadataFilter || hasQueryText
    ? Math.max(requestedTopK * 24, 120)
    : requestedTopK;
  const searchTopK = Math.min(searchTopKBase, 500);

  const results = await similaritySearch(
    resolvedCollectionId,
    queryEmbedding,
    searchTopK
  );
  const filtered = applyMetadataFilters(results, options);
  const reranked = rerankResults(filtered, options);

  return reranked.slice(0, requestedTopK).map(normalizeResult);
}

export async function retrieveByCollectionId(
  collectionId: string,
  query: string,
  options: RetrievalOptions = {}
): Promise<RetrievedChunk[]> {
  const embeddingQuery = expandQueryForCorpus(query);
  const embedding = await generateEmbedding(embeddingQuery);
  const queryAwareOptions: RetrievalOptions = {
    ...options,
    queryText: options.queryText ?? query,
  };
  return retrieveByEmbedding(collectionId, embedding, queryAwareOptions);
}

export async function retrieve(
  query: string,
  options: RetrievalOptions = {}
): Promise<RetrievedChunk[]> {
  const collection = await getOrCreateCollection(COLLECTION_NAME);
  return retrieveByCollectionId(collection.id, query, {
    ...options,
    queryText: options.queryText ?? query,
  });
}

if (require.main === module) {
  indexCorpus();
}
