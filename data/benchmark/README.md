# Benchmark data

This directory intentionally contains **no expert-labeled benchmark** yet.

The existing `data/eval_queries.json` is a 20-query preliminary retrieval/answer dataset, not a validated gold-standard claim corpus.

Follow [annotation protocol](../../docs/benchmark-annotation-protocol.md) to collect and independently adjudicate genuine university-document examples.

Expected schema: `GoldBenchmark` in `src/modules/evaluation/benchmark.gold.ts`. Validate a completed dataset with:

```bash
npm run benchmark:validate -- path/to/gold.json
```

All test fixtures in `src/tests/benchmark.checks.ts` are synthetic and MUST NOT be used as experimental findings. Keep sensitive student information and unlicensed university documents out of this repository.
