import fs from "fs";
import path from "path";
import { generateEmbedding } from "../embeddings/embedding.service";
import { getOrCreateCollection, addDocuments, similaritySearch, SearchResult } from "../vector-db/chroma.service";

const INGESTED_FILE = path.join(__dirname, "../../../data/ingested_corpus.jsonl");
const COLLECTION_NAME = process.env.CHROMA_COLLECTION ?? "university-corpus";

export async function indexCorpus() {
  const collection = await getOrCreateCollection(COLLECTION_NAME);
  const lines = fs.readFileSync(INGESTED_FILE, "utf-8").split(/\r?\n/).filter(Boolean);
  const docs = [];
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
    docs.push({
      id: `${metadata.documentId}_${metadata.year ?? "na"}_${metadata.subsection}`,
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

export async function retrieve(
  query: string,
  options: RetrievalOptions = {}
): Promise<Array<SearchResult & { confidence: number; documentYear?: number; documentType?: string }>> {
  const collection = await getOrCreateCollection(COLLECTION_NAME);
  const embedding = await generateEmbedding(query);
  let results = await similaritySearch(collection.id, embedding, options.topK ?? 5);

  // Metadata filtering
  if (options.year) {
    results = results.filter(r => r.metadata && r.metadata.year === options.year);
  }

  // Version preference: if no year specified, prefer most recent year for those with year, but keep results without year
  if (!options.year && results.length > 0) {
    const withYear = results.filter(r => r.metadata && r.metadata.year !== undefined);
    const withoutYear = results.filter(r => !r.metadata || r.metadata.year === undefined);
    let filtered: typeof results = [];
    if (withYear.length > 0) {
      const maxYear = Math.max(...withYear.map(r => Number(r.metadata!.year)));
      filtered = withYear.filter(r => Number(r.metadata!.year) === maxYear);
    }
    results = filtered.concat(withoutYear);
  }

  // Add confidence logging
  return results.map(r => ({
    ...r,
    confidence: 1 - r.distance,
    documentYear: r.metadata?.year !== undefined ? Number(r.metadata.year) : undefined,
    documentType: r.metadata?.documentType ? String(r.metadata.documentType) : undefined,
  }));
}

if (require.main === module) {
  indexCorpus();
}
