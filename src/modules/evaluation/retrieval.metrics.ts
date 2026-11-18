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
    if (year.length > 0) {
      const yearToken = `_${year}`;
      if (base.endsWith(yearToken) || base.includes(`${yearToken}_`)) {
        return base;
      }
      return `${base}_${year}`;
    }
    return base;
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
  const relevantDocumentSet = new Set(normalizedRelevant);
  const relevantRetrieved = normalizedRetrieved.filter((id) =>
    relevantDocumentSet.has(id)
  );

  // Precision is calculated per retrieved chunk; recall is calculated per
  // unique relevant document. Multiple chunks from the same document must
  // not inflate document-level recall above 1.
  const precisionAtK = relevantRetrieved.length / k;
  const uniqueRelevantRetrieved = new Set(relevantRetrieved);

  const recallAtK =
    normalizedRelevant.length > 0
      ? uniqueRelevantRetrieved.size / normalizedRelevant.length
      : 0;

  const averageSimilarity =
    retrievedDocs.reduce((sum, doc) => sum + (1 - doc.distance), 0) / k;

  return {
    precisionAtK,
    recallAtK,
    averageSimilarity,
  };
}
