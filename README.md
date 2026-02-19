# RAG Trust Evaluation

Master's thesis project.

# RAG Trust Evaluation — Project README

Stable RAG evaluation engine for local benchmarking and regression testing.

## Quick start

1. Install deps:
   npm install

2. Configure `.env` (examples in repo). Required:
   - PORT (default 4000)
   - OLLAMA_BASE_URL (default http://localhost:11434)
   - CHROMA_BASE_URL (default http://localhost:8000)
   - CHROMA_COLLECTION
   - TRUST_WEIGHT_FAITH, TRUST_WEIGHT_PREC, TRUST_WEIGHT_SIM
   - EVAL_MODEL

3. Run:
   npm run dev

## Core endpoints

- GET /health — liveness
- POST /ask — quick LLM call (body: { question })
- POST /embed — generate embedding (body: { text })
- POST /vector-test — end-to-end embedding + Chroma store + search (used for sanity checks)
- POST /rag/query — single RAG query (body: { collectionId, query, topK? })
- POST /rag/evaluate — single evaluation (body: { collectionId, query, relevantDocumentIds, groundTruth? })
- POST /rag/evaluate/batch — batch evaluation (body: { collectionId, dataset, generationModel?, evaluationModel?, maxConcurrency? })
- POST /rag/evaluate/multimodel — multi-model benchmark (body: { collectionId, dataset, models?, maxConcurrency? })
- GET /benchmark/history — persisted benchmark history (filters: generationModel, benchmarkId)

## Key features

- Trust score composed of configurable weights (env): faithfulness, precision, similarity.
- Semantic compensation: high faithfulness + high similarity prevents trust collapse when retrieval IDs mismatch.
- p95 latencies (generation & evaluation), cold-start detection, concurrency limiter.
- Persistence: run metadata saved to `data/benchmarks.json` (timestamp, benchmarkId, datasetHash, models, statistics).
- Multi-model runs share a parent benchmarkId for grouping.

## Files of interest

- src/modules/evaluation/evaluation.service.ts — metrics, persistence, leaderboard logic
- src/modules/rag/rag.service.ts — RAG workflow (embed → retrieve → generate)
- src/modules/llm/ollama.service.ts — Ollama client
- test-evaluation.sh — automated validation script (uses node, no jq required)

## Running validation tests

Start server, then from repo root:
bash test-evaluation.sh

The script runs:
- Normal batch (validates datasetSize, p95, trustWeights, evaluationVersion)
- Multi-model (validates benchmarkId, leaderboard)
- Edge case (empty dataset rejected)
- History read
