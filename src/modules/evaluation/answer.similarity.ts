import { generateEmbedding } from "../embeddings/embedding.service";

export async function calculateAnswerSimilarity(
  answer: string,
  groundTruth: string
): Promise<number> {
  const [aEmb, gEmb] = await Promise.all([
    generateEmbedding(answer),
    generateEmbedding(groundTruth),
  ]);

  const dot = aEmb.reduce((sum, val, i) => sum + val * gEmb[i], 0);

  const normA = Math.sqrt(aEmb.reduce((sum, val) => sum + val * val, 0));
  const normB = Math.sqrt(gEmb.reduce((sum, val) => sum + val * val, 0));

  return dot / (normA * normB);
}
