import { generate } from "../llm/ollama.service";

/** Reject invalid LLM-judge output rather than inventing a numerical score. */
export function parseFaithfulnessScore(response: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.trim());
  } catch {
    throw new Error("faithfulness_evaluation_invalid_json");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("faithfulness_evaluation_invalid_score");
  }

  const score = (parsed as Record<string, unknown>).score;
  if (
    typeof score !== "number" ||
    !Number.isFinite(score) ||
    score < 0 ||
    score > 1
  ) {
    throw new Error("faithfulness_evaluation_invalid_score");
  }
  return score;
}

export async function evaluateFaithfulness(
  context: string,
  answer: string,
  evaluationModel?: string
): Promise<number> {
  const prompt = `You are an AI evaluator specialized in assessing answer faithfulness.

Evaluate whether the answer is supported by and faithful to the provided context.

Context:
${context}

Answer:
${answer}

Respond ONLY in valid JSON format with NO additional text:
{
  "score": number between 0 and 1,
  "reason": "short explanation of why this score"
}`;

  const response = await generate(prompt, evaluationModel);
  return parseFaithfulnessScore(response);
}
