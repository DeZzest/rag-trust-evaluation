# Контрольоване виконання RAG-запитів до погодженого corpus snapshot (пакет 14)

**Мета:** використовувати лише явно затверджений локальний `corpus-snapshot/1` з новою **вже індексованою** колекцією ChromaDB, не змішуючи його зі старим індексом.

## Попередні умови

1. PDF-сторінки мають бути фактично перевірені людиною, їхні редакції — задокументовані. Попередні пакети 10–12 лише дають інструменти для цього, але не генерують справжніх рецензій.
2. `npm run corpus:verify -- --snapshot-dir data/corpus_snapshots/reviewed-ocr-v1` має успішно завершитися; збережіть точний `corpusSnapshotId`.
3. Snapshot уже індексований **новою** колекцією через `corpus:index-snapshot --execute` з пакета 13; колекція не повинна бути частково записана.
4. У запущеному Node backend мають бути доступні Ollama, ChromaDB v2 та Python, який виконує `scripts/verify_reviewed_snapshot.py`. Параметри `EMBEDDING_MODEL`, `OLLAMA_BASE_URL`, `CHROMA_BASE_URL` слід фіксувати в експериментальному журналі.

## Вказати затверджений snapshot — тільки в серверному середовищі

```env
RAG_APPROVED_SNAPSHOT_DIR=data/corpus_snapshots/reviewed-ocr-v1
RAG_APPROVED_SNAPSHOT_ID=sha256:REPLACE_WITH_REAL_64_LOWERCASE_HEX
RAG_ALLOW_PARTIAL_SNAPSHOT=false
```

Текст `REPLACE_WITH_REAL_64_LOWERCASE_HEX` — **не справжній хеш**. Замініть його значенням із `corpus:verify`. За відсутності змінних endpoint завершується відмовою. Частковий набір PDF не допускається до запитів, якщо власник сервера явно не встановить `RAG_ALLOW_PARTIAL_SNAPSHOT=true`. Цей дозвіл **не** робить корпус репрезентативним.

## Новий endpoint

```http
POST /rag/query/snapshot
Content-Type: application/json

{
  "query": "Які правила передбачає перевірений документ?",
  "topK": 3,
  "includeClaimGrounding": true
}
```

У HTTP body **заборонені** `collectionId`, `collectionName`, `snapshotDir`, `corpusSnapshotId` та невідомі поля. Єдине джерело довіреного snapshot — серверна конфігурація. Дозволяються `query`, `topK` (ціле 1–20), `year`, `documentType`, `generationModel`, `evaluationModel`, `includeFaithfulness`, `includeClaimGrounding`.

Кожен запит виконує офлайнову перевірку snapshot через Python (можливі додаткові витрати часу), звіряє хеш JSONL і структуру фрагментів, шукає **тільки вже існуючу** колекцію `rag_snapshot_<64hex>` без виклику get-or-create, а також перевіряє ChromaDB count. Якщо кількість не збігається, запит відхиляється.

Після retrieval, **перед передачею контексту в LLM**, кожне повернуте джерело повинно мати правильні `corpusSnapshotId`, `reviewStatus=approved`, `documentVersion`, `chunkId`, `pageNumber`, `sourcePdfSha256`, `reviewedTextSha256`. Невідповідність блокує генерацію. Якщо retrieval повернув нуль результатів, діє наявне утримання від фактологічної відповіді з нульовим Trust Score.

Успішний JSON містить `corpusSnapshotId`, `collectionId`, `collectionName`, `indexedChunkCount`, `partialSnapshot` та наявні поля RAG (`answer`, `sources`, `citations`, `trust`, `performance`). При відмові немає fallback до `lute_university_docs` або `university-corpus`.

**Важливо:** попередні endpoints `/rag/query` та `/rag/evaluate` залишаються з попередньою поведінкою і можуть приймати довільний collection ID. Для дослідницьких прогонів із підтвердженим snapshot слід використовувати новий endpoint. Цей пакет не встановлює авторизацію доступу; її слід забезпечити на рівні розгортання.

## Яких гарантій ще немає

- Збіг Chroma count і metadata вибраних фрагментів **не доводить**, що всі embeddings і всі записи колекції побайтово відповідають локальному snapshot. Для високонадійного підтвердження потрібне окреме повне звіряння колекції/embedding-моделі.
- Ім'я колекції пакета 13 прив'язано до `corpusSnapshotId`, а **не до embedding-моделі або її версії**. Потрібен протокол experiment configuration, інакше порівняння різних embedder-ів може бути некоректним.
- Успішний CI на синтетичних прикладах не підтверджує реальний запуск Ollama/ChromaDB, якість OCR, чинність нормативних актів чи наукову ефективність Trust Score.
- Успішна відповідь старого `/rag/query` не має еквівалентних гарантій походження.

## Автоматизовані тести

```bash
npm run test:snapshot-query
```

Синтетичні регресійні тести охоплюють: відмову без серверної конфігурації, заборону довільного source/collection у HTTP-запиті, partial-snapshot gate, відсутність колекції, count mismatch, чужий snapshot ID, невалідну сторінку, незатверджений фрагмент, відсутність metadata та успішну маршрутизацію без реальних HTTP-запитів.
