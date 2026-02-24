# RAG Trust Evaluation

Trust-aware RAG engine with a production-style website ingestion pipeline:

```
University Website
  -> Scraper (HTML/PDF + raw cache)
  -> Text Normalizer
  -> Structured TXT Corpus
  -> Ingest (section/subsection chunks + metadata)
  -> Chroma Index
  -> RAG Retrieval + Trust
  -> Evaluation + UI
```

## Data pipeline

1. `npm run scrape:lute`
   - Reads controlled sources from `data/source_urls.json`.
   - Respects `robots.txt`.
   - Saves raw files to `data/raw_html/` and `data/raw_pdf/`.
   - Builds structured documents in `data/university_corpus/`.
2. `npm run ingest:corpus`
   - Builds `data/ingested_corpus.jsonl`.
   - Semantic chunking by `Section` / `Subsection` (not fixed char windows).
   - Enriches chunk metadata:
     - `source`
     - `documentTitle`
     - `category`
     - `year`
     - `section`
     - `subsection`
     - `url`
     - `scrapedAt`
3. `npm run index:corpus`
   - Indexes into Chroma collection `lute_university_docs` by default.

## Quick start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure `.env`:
   - `PORT` (default `4000`)
   - `OLLAMA_BASE_URL` (default `http://localhost:11434`)
   - `CHROMA_BASE_URL` (default `http://localhost:8000`)
   - `CHROMA_COLLECTION` (default `lute_university_docs`)
   - `TRUST_WEIGHT_FAITH`, `TRUST_WEIGHT_PREC`, `TRUST_WEIGHT_SIM`
   - `EVAL_MODEL`
3. Build corpus/index and run:
   ```bash
   npm run scrape:lute
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
- `POST /rag/query`
- `POST /rag/evaluate`
- `POST /rag/evaluate/batch`
- `POST /rag/evaluate/multimodel`
- `GET /benchmark/history`

## Evaluation dataset

- `data/eval_queries.json` now includes 20 queries.
- Each query includes `expectedSourceSection` plus `relevantDocumentIds`.

## Local checks

```bash
npm run test:phase3
```
