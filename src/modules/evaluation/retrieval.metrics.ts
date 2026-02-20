import { SearchResult } from "../vector-db/chroma.service";

function normalizeRelevantDocumentId(id: string): string {
  const normalizedPath = id.replace(/\\/g, "/");
  const baseName = normalizedPath.split("/").pop() ?? normalizedPath;
  return baseName.replace(/\.txt$/i, "").trim().toLowerCase();
}

function normalizeRetrievedDocumentId(doc: SearchResult): string {
  const metadataDocId = doc.metadata?.documentId;
  const metadataYear = doc.metadata?.year;

  if (typeof metadataDocId === "string" && metadataDocId.trim().length > 0) {
    const base = metadataDocId.trim().toLowerCase();
    const year =
      metadataYear !== undefined && metadataYear !== null
        ? String(metadataYear).trim()
        : "";
    return year.length > 0 ? `${base}_${year}` : base;
  }

  const fallbackId = doc.id.trim().toLowerCase();
  const match = fallbackId.match(/^(.*)_(\d{4}|na)_(.+)$/);
  if (!match) {
    return fallbackId.replace(/\.txt$/i, "");
  }

  const base = match[1];
  const year = match[2];
  if (year === "na") return base;
  return `${base}_${year}`;
}

export function calculateRetrievalMetrics(
  retrievedDocs: SearchResult[],
  relevantDocumentIds: string[]
) {
  const k = retrievedDocs.length;
  if (k === 0) {
    return {
      precisionAtK: 0,
      recallAtK: 0,
      averageSimilarity: 0,
    };
  }

  const normalizedRelevant = Array.from(
    new Set(relevantDocumentIds.map(normalizeRelevantDocumentId))
  );
  const normalizedRetrieved = retrievedDocs.map(normalizeRetrievedDocumentId);
  const relevantRetrieved = normalizedRetrieved.filter((id) =>
    normalizedRelevant.includes(id)
  );

  const precisionAtK = relevantRetrieved.length / k;

  const recallAtK =
    normalizedRelevant.length > 0
      ? relevantRetrieved.length / normalizedRelevant.length
      : 0;

  const averageSimilarity =
    retrievedDocs.reduce((sum, doc) => sum + (1 - doc.distance), 0) / k;

  return {
    precisionAtK,
    recallAtK,
    averageSimilarity,
  };
}
