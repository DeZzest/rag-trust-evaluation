import fetch from "node-fetch";

const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "nomic-embed-text";

/**
 * Generates embeddings for the given text using Ollama
 * @param text - The text to embed
 * @returns Promise<number[]> - The embedding vector
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    if (!text || text.trim().length === 0) {
      throw new Error("Text cannot be empty");
    }

    const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        prompt: text,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama embedding error: ${text}`);
    }

    const data = (await response.json()) as { embedding?: number[] };

    if (!data.embedding) {
      throw new Error("Ollama returned an empty embedding.");
    }

    return data.embedding;
  } catch (error) {
    throw error;
  }
}

/**
 * Generates embeddings for multiple texts in batch
 * @param texts - Array of texts to embed
 * @returns Promise<number[][]> - Array of embedding vectors
 */
export async function generateEmbeddingsBatch(
  texts: string[]
): Promise<number[][]> {
  try {
    if (!texts || texts.length === 0) {
      throw new Error("Texts array cannot be empty");
    }

    const embeddings = await Promise.all(
      texts.map((text) => generateEmbedding(text))
    );

    return embeddings;
  } catch (error) {
    throw error;
  }
}

export const embeddingConfig = {
  baseUrl: OLLAMA_BASE_URL,
  model: EMBEDDING_MODEL,
};