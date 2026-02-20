# RAG Trust Evaluation

Trust-aware RAG engine for local benchmarking with Ollama + Chroma + metadata-aware retrieval + citation validation.

## Phase 3 Trust-Aware Flow

```
Query
  -> Metadata-aware Vector Retrieval
  -> Context Builder (metadata + citation map)
  -> LLM generation (citation-enforced prompt)
  -> Citation extraction/validation (strict + one retry)
  -> Evaluation layer
  -> Trust score aggregation
```

### Key behavior
- Retrieval uses metadata filters (`year`, `documentType`) and latest-year preference.
- Generated answers must use numeric citations `[n]`.
- Citation validation checks:
  - citations exist
  - citation indices are in range `1..N`
  - sentence-level citation coverage
- If validation fails, generation is retried once.
- `POST /rag/query` returns trust metrics (lightweight mode by default).
- Evaluation mode adds full trust with faithfulness + similarity + citation signals.

## Project structure & data policy

- Only synthetic corpus `.txt` files in `data/university_corpus/` are versioned.
- Generated artifacts (`data/ingested_corpus.jsonl`, Chroma DB contents, benchmarks output) are local-only.

## Quick start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure `.env`:
   - `PORT` (default `4000`)
   - `OLLAMA_BASE_URL` (default `http://localhost:11434`)
   - `CHROMA_BASE_URL` (default `http://localhost:8000`)
   - `CHROMA_COLLECTION` (default `university-corpus`)
   - `TRUST_WEIGHT_FAITH`, `TRUST_WEIGHT_PREC`, `TRUST_WEIGHT_SIM`
   - `EVAL_MODEL`
3. Build corpus/index and run server:
   ```bash
   npm run ingest:corpus
   npm run index:corpus
   npm run dev
   ```

## Frontend dashboard

1. Install frontend dependencies:
   ```bash
   cd frontend
   npm install
   ```
2. Run Vite dev server:
   ```bash
   npm run dev
   ```
3. Open:
   - `http://localhost:5173`

The frontend calls backend endpoints:
- `POST /rag/query`
- `POST /rag/evaluate`

Set `VITE_API_BASE_URL` if backend runs on a non-default host/port.

## Core endpoints

- `GET /health`
- `POST /ask`
- `POST /embed`
- `POST /vector-test`
- `POST /rag/query`
- `POST /rag/evaluate`
- `POST /rag/evaluate/batch`
- `POST /rag/evaluate/multimodel`
- `GET /benchmark/history`

## `POST /rag/query` (Phase 3)

### Request
```json
{
  "collectionId": "string",
  "query": "What is the minimum admission score in 2024?",
  "topK": 3,
  "year": 2024,
  "documentType": "admission",
  "generationModel": "llama3.2",
  "includeFaithfulness": false,
  "evaluationModel": "mistral"
}
```

### Response (additive, backward-compatible)
```json
{
  "success": true,
  "collectionId": "string",
  "answer": "Minimum admission score is 75/100 [1].",
  "trustScore": 0.92,
  "metrics": {
    "trustScore": 0.92,
    "citationCoverage": 1,
    "citationValidity": 1
  },
  "retrieved": [],
  "sources": [],
  "contextTrace": [],
  "citations": [1],
  "citationValidation": {
    "isValid": true,
    "coverage": 1,
    "citationValidity": 1,
    "retryCount": 0,
    "issues": []
  },
  "trust": {
    "score": 0.92,
    "mode": "lightweight",
    "breakdown": {}
  },
  "performance": {}
}
```

## Evaluation behavior

- Retrieval metrics use document-level normalization:
  - relevant ids: filename without `.txt`
  - retrieved ids: `metadata.documentId + "_" + metadata.year` (if year exists), otherwise `metadata.documentId`
- Full trust scoring combines:
  - faithfulness, precision, semantic similarity
  - citation coverage and validity
- Citation policy cap:
  - lightweight trust capped at `0.35` when citations still invalid after retry
  - full trust capped at `0.60` when citations still invalid after retry

## Phase 3 checks

Run lightweight automated checks (no new dependencies):

```bash
npm run test:phase3
```

This validates:
- context formatting and citation map trace
- citation extraction/validation rules
- lightweight/full trust formula behavior
- document-level retrieval id normalization
