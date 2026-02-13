# RAG Trust Evaluation

Master's thesis project.

Stack:
- TypeScript
- Node.js

Status:
Initial project scaffold created.

## Backend Server

- **Run server**: `npm run dev`
- **Default port**: `3000` (can be overridden via `PORT` environment variable)
- **Health endpoint**: `GET /health` → returns JSON with a simple status field.

## Local LLM (Ollama)

- **Install Ollama**: download and install from `https://ollama.com`.
- **Download model**: `ollama pull llama3.2`.
- **Run Ollama**: ensure Ollama is running locally (default `http://localhost:11434`).
- **Test /ask endpoint**:
  - Start backend: `npm run dev`
  - Send request (example):
    - `POST http://localhost:4000/ask`
    - Body: `{ "question": "What is 2 + 2?" }`
