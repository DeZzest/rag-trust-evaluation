# RAG Trust Evaluation

Stable, production-style RAG evaluation engine for local benchmarking, trust analysis, and regression testing.

## Project structure & data policy

- Only synthetic academic corpus `.txt` files in `data/university_corpus/` are versioned (pushed to git).
- All generated artifacts (`data/ingested_corpus.jsonl`, Chroma DB, vector stores) are **not** versioned — they are rebuilt locally.
- This ensures reproducibility, minimal repo size, and no sensitive or machine-specific data in git.

## Quick start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure `.env` (see `.env.example`):
   - `PORT` (default 4000)
   - `OLLAMA_BASE_URL` (default http://localhost:11434)
   - `CHROMA_BASE_URL` (default http://localhost:8000)
   - `CHROMA_COLLECTION` (e.g. university-corpus)
   - `TRUST_WEIGHT_FAITH`, `TRUST_WEIGHT_PREC`, `TRUST_WEIGHT_SIM`
   - `EVAL_MODEL`

3. Prepare the vector index:
   ```bash
   npm run ingest:corpus   # Chunk and structure corpus into JSONL
   npm run index:corpus    # Generate embeddings and index into Chroma
   npm run dev             # Start the server (or: npm run server)
   ```

## Core endpoints

- `GET /health` — liveness
- `POST /ask` — quick LLM call (body: `{ question }`)
- `POST /embed` — generate embedding (body: `{ text }`)
- `POST /vector-test` — end-to-end embedding + Chroma store + search (sanity check)
- `POST /rag/query` — single RAG query (body: `{ collectionId, query, topK? }`)
- `POST /rag/evaluate` — single evaluation (body: `{ collectionId, query, relevantDocumentIds, groundTruth? }`)
- `POST /rag/evaluate/batch` — batch evaluation (body: `{ collectionId, dataset, ... }`)
- `POST /rag/evaluate/multimodel` — multi-model benchmark (body: `{ collectionId, dataset, models?, ... }`)
- `GET /benchmark/history` — persisted benchmark history

## Key features

- Trust score: configurable weights (faithfulness, precision, similarity)
- Version-aware retrieval: always prefers latest year if not specified
- Metadata filtering: filter by year, document type, etc.
- Cross-reference detection for advanced trust/temporal analysis
- p95 latency, cold-start detection, concurrency limiter
- All evaluation runs are reproducible from corpus `.txt` files

## Files of interest

- `src/modules/ingest/ingest_corpus.ts` — chunking, metadata, cross-ref extraction
- `src/modules/vector/index_corpus.ts` — embedding, vector DB, metadata-aware retrieval
- `src/modules/evaluation/evaluation.service.ts` — metrics, persistence, leaderboard
- `src/modules/rag/rag.service.ts` — RAG workflow (embed → retrieve → generate)
- `src/modules/llm/ollama.service.ts` — Ollama client

## Running validation tests

Start server, then from repo root:
```bash
bash test-evaluation.sh
```
The script runs:
- Normal batch (validates datasetSize, p95, trustWeights, evaluationVersion)
- Multi-model (validates benchmarkId, leaderboard)
- Edge case (empty dataset rejected)
- History read
