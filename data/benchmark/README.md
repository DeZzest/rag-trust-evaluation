# Benchmark data

This directory intentionally contains **no expert-labeled benchmark** yet.

The existing `data/eval_queries.json` is a 20-query preliminary retrieval/answer dataset, not a validated gold-standard claim corpus.

Follow [annotation protocol](../../docs/benchmark-annotation-protocol.md) to collect and independently adjudicate genuine university-document examples.

Expected schema: `GoldBenchmark` in `src/modules/evaluation/benchmark.gold.ts`. Validate a completed dataset with:

```bash
npm run benchmark:validate -- path/to/gold.json
```

All test fixtures in `src/tests/benchmark.checks.ts` are synthetic and MUST NOT be used as experimental findings. Keep sensitive student information and unlicensed university documents out of this repository.

## Підготовка черги на експертну розмітку

Локально після `npm run scrape:lute` та `npm run ingest:corpus` запустіть:

```bash
npm run benchmark:prepare -- data/ingested_corpus.jsonl data/eval_queries.json data/benchmark/annotation-queue.json
```

Інструмент використовує **лише фактичний текст** `ingested_corpus.jsonl` та ідентифікатори в `eval_queries.json`. Він створює чергу зі статусом `needs_manual_annotation`, кандидатними текстами, хешами вхідних файлів і полем `missingDocumentIds`. **Це не еталонні висновки й не прогноз LLM.**

Результат не можна валідувати командою `benchmark:validate` до завершення окремої експертної розмітки та перетворення в gold-схему. За замовчуванням файли `annotation-queue*.json` і `gold*.json` захищені від випадкового коміту через `.gitignore`.

CLI відмовиться перезаписати наявний файл. Для повторного запуску збережіть старий файл або виберіть інше ім'я результату. Якщо немає жодного відповідного фрагмента, виконання завершиться помилкою; перевірте локальний корпус та його версії.

## Дві незалежні оцінки та погодження (пакет 6)

Для вже підготовленої локальної `annotation-queue.json` вручну створіть `annotation-review.json` за схемою `annotation-review/1`. **Жодних оцінок система не генерує сама.**

Потрібні `datasetId`, `originDatasetId`, `corpusSnapshotId`, `queriesSha256` з черги; глобальна пара `annotatorIds` (рівно два різні ідентифікатори), `adjudicatorId`; масив `cases` (можна підмножину черги). У кожного випадку: `id`, `split` (`dev` чи `test`), `sourceVersions` зі списком `sourceId`, `documentVersion` і `verificationNote`; `claims` із ручними `id`, `text`, двома `reviews` та **явним** `adjudication`. Кожна первинна оцінка має `annotatorId` і `verdict`; для `supported`/`contradicted` також `sourceId` і `evidenceQuote` (цитата від 12 символів, повинна входити в джерело). Для погодженого результату додатково потрібна непорожня `rationale`.

Перевірка без збереження:

```bash
npm run benchmark:adjudicate -- data/benchmark/annotation-queue.json data/benchmark/annotation-review.json
```

Після фактичної незалежної розмітки та погодження **всіх** тверджень створіть gold-файл:

```bash
npm run benchmark:adjudicate -- data/benchmark/annotation-queue.json data/benchmark/annotation-review.json data/benchmark/gold-v1.json
npm run benchmark:validate -- data/benchmark/gold-v1.json
```

CLI не перезаписує вихідні дані або наявний gold. Звіт містить спостережувану згоду анотаторів, очікувану випадкову згоду та коефіцієнт Коена κ **до** погодження. Якщо κ невизначено, відображається `null`. Ідентифікатори та примітки версійності не замінюють людську перевірку незалежності й чинності джерел. `annotation-review*.json` і `gold*.json` не повинні потрапляти у публічний Git.
