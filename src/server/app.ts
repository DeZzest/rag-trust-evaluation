import express, { Application, Request, Response } from "express";
import { generate } from "../services/ollama.service";

const app: Application = express();

app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.post("/ask", async (req: Request, res: Response) => {
  const question = req.body?.question;

  if (typeof question !== "string" || !question.trim()) {
    return res
      .status(400)
      .json({ error: "Field 'question' is required and must be a string." });
  }

  try {
    const answer = await generate(question);
    res.json({ answer });
  } catch (error) {
    // Basic error handling for Ollama issues
    console.error("Error while calling Ollama:", error);

    let message = "Internal server error.";
    if (error instanceof Error) {
      const lower = error.message.toLowerCase();
      if (lower.includes("ecconnrefused") || lower.includes("connect")) {
        message = "Ollama is not running or not reachable.";
      } else if (lower.includes("model") && lower.includes("not found")) {
        message = "Requested Ollama model was not found.";
      }
    }

    res.status(500).json({ error: message });
  }
});

export default app;
