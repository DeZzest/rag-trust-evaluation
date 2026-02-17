import { generate } from "../llm/ollama.service";

export async function evaluateFaithfulness(
  context: string,
  answer: string,
  evaluationModel?: string
): Promise<number> {
  try {
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

    // Try to parse JSON response
    try {
      const parsed = JSON.parse(response);
      const score = parsed.score ?? 0;

      // Ensure score is within valid range
      if (typeof score === "number" && !isNaN(score)) {
        return Math.max(0, Math.min(1, score));
      }

      return 0;
    } catch (parseError) {
      console.warn(
        "Failed to parse faithfulness response as JSON:",
        response
      );

      // Fallback: try to extract number from response
      const match = response.match(/([0-9]*\.?[0-9]+)/);
      if (match) {
        const score = parseFloat(match[1]);
        if (!isNaN(score)) {
          return Math.max(0, Math.min(1, score));
        }
      }

      console.warn("Could not extract faithfulness score, defaulting to 0.5");
      return 0.5; // Default to neutral score if parsing fails
    }
  } catch (error) {
    console.error("Error evaluating faithfulness:", error);
    throw error;
  }
}
