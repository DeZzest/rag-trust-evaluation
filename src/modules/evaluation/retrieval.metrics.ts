import { SearchResult } from "../vector-db/chroma.service";

export function calculateRetrievalMetrics(
  retrievedDocs: SearchResult[],
  relevantDocumentIds: string[]
) {
  const k = retrievedDocs.length;

  const retrievedIds = retrievedDocs.map((d) => d.id);

  const relevantRetrieved = retrievedIds.filter((id) =>
    relevantDocumentIds.includes(id)
  );

  const precisionAtK = relevantRetrieved.length / k;

  const recallAtK =
    relevantRetrieved.length / relevantDocumentIds.length;

  const averageSimilarity =
    retrievedDocs.reduce((sum, doc) => sum + (1 - doc.distance), 0) / k;

  return {
    precisionAtK,
    recallAtK,
    averageSimilarity,
  };
}
