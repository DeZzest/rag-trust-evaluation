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

## Офлайнове порівняння з gold (пакет 7)

Після створення та незалежного погодження `gold-v1.json` сформуйте файл `claim-predictions/1`, у якому кожен прогноз зіставлений з еталонним `caseId` та `claimId`. Основні поля: `schemaVersion`, `datasetId`, `corpusSnapshotId`, `runId`, `methodId`, `modelId`, `evaluationMode`, `configuration` і масив `predictions` з трійками `caseId`, `claimId`, `verdict`.

`evaluationMode` приймає `gold_claim_classification` (класифікація готових еталонних тверджень) або `aligned_rag_claims` (окремо узгоджені твердження з RAG-відповідей). Ці режими **не однакові** й потребують окремої інтерпретації.

```bash
npm run benchmark:score -- data/benchmark/gold-v1.json data/benchmark/model-predictions.json data/benchmark/model-report.json
```

Звіт містить загальні метрики та окремі результати для `dev` і `test`, а також SHA-256 обох точних вхідних файлів. Невідомі, відсутні або повторені `caseId + claimId` відхиляються. CLI не перезаписує існуючі результати. Порожній split повертається як `null`.

`benchmark:score` не викликає LLM і **не створює прогнози**. Синтетичні unit-тести не є експериментальними результатами.

## Аудит підготовленого корпусу (пакет 8)

Після створення `annotation-queue.json` перевірте якість корпусу й різноманітність відібраних фрагментів:

```bash
npm run benchmark:audit -- data/ingested_corpus.jsonl data/benchmark/annotation-queue.json data/benchmark/corpus-readiness.json
```

Команда не викликає LLM і не призначає жодних експертних міток. Вона перевіряє SHA-256 корпусу і кандидатів, рахує кількість фрагментів, документів, PDF-похідних документів, коротких та однакових текстів, кількість і повторне використання кандидатних джерел. Отримані `warnings` є **евристичними сигналами**, не оцінкою фактологічної точності. Звіт зберігається локально, без фрагментів тексту.


## Малий реальний пілот магістерської (етап 18)

Підготовлено три перевірені за **байтовим SHA-256, але не експертно підтверджені** PDF джерела з переданого власником архіву; 28 фізичних сторінок:
- pilot-source-selection.json — URL, фактична назва документа, SHA-256, статус human_review_pending;
- pilot-question-seeds.json — 29 попередніх українськомовних запитань, сторінкові підказки та designIntent (НЕ gold-verdict);
- pilot-eval-queries.json — ті самі запитання у форматі benchmark:prepare. Поле relevantDocumentIds використано лише для вибору **кандидатних** джерел, а не як експертну мітку. Для запиту за межами підкорпусу перелічені всі три документи як контрольний пошуковий пул.

**Порядок роботи:** docs/stage18-pilot-annotation-guide.md. Для OCR є окремий ZIP лише з трьома оригінальними PDF, доступний у розмові; PDF не публікуються в репозиторії.

На етапі 18 усунено помилку ідентичності: у підготовленій черзі reviewed snapshot використовує вже зафіксований corpusSnapshotId із metadata JSONL, а не обчислює новий ID за SHA-256 JSONL. Змішування різних snapshot ID заборонено. Для старих нетегованих JSONL залишено попередню поведінку. Перед створенням черги обов'язково виконати corpus:verify; сам benchmark:prepare не перевіряє оригінальні PDF.

Це НЕ готовий gold, НЕ чинні редакції документів і НЕ наукові результати. Для gold потрібні дві реальні незалежні експертні оцінки, арбітраж і звірка джерельних фрагментів.
