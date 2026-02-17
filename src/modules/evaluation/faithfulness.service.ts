import { generate } from "../llm/ollama.service";

export async function evaluateFaithfulness(
  context: string,
  answer: string
): Promise<number> {
  const prompt = `
You are an AI evaluator.

Your task:
Determine whether the answer is fully supported by the provided context.

Context:
${context}

Answer:
${answer}

Respond with a single number between 0 and 1:
0 = completely hallucinated
1 = fully grounded in context
`;

  const response = await generate(prompt);

  const match = response.match(/([0-9]*\.?[0-9]+)/);
  const score = match ? parseFloat(match[1]) : 0;

  if (isNaN(score)) return 0;

  return Math.max(0, Math.min(1, score));
}
