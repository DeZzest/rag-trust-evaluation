import fetch from "node-fetch";

const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.2";
const OLLAMA_EVALUATION_MODEL = process.env.OLLAMA_EVALUATION_MODEL ?? "mistral";

export interface GenerateOptions {
  /** Ollama structured-output mode, used by strict JSON parsers only. */
  format?: "json";
}

/** Pure request builder to keep the default free-form generation unchanged. */
export function buildGenerateRequestBody(
  prompt: string,
  model: string,
  options: GenerateOptions = {}
) {
  return {
    model,
    prompt,
    stream: false,
    ...(options.format ? { format: options.format } : {}),
  };
}

export async function generate(
  prompt: string,
  modelName?: string,
  options: GenerateOptions = {}
): Promise<string> {
  try {
    const model = modelName ?? OLLAMA_MODEL;

    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildGenerateRequestBody(prompt, model, options)),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama error: ${text}`);
    }

    const data = (await response.json()) as { response?: string };

    if (!data.response) {
      throw new Error("Ollama returned an empty response.");
    }

    return data.response;
  } catch (error) {
    throw error;
  }
}

export const ollamaConfig = {
  baseUrl: OLLAMA_BASE_URL,
  model: OLLAMA_MODEL,
  evaluationModel: OLLAMA_EVALUATION_MODEL,
};

