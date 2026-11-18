# Пакет 14 — контрольований RAG-запит до погодженого corpus snapshot

**База:** main @ `eb993bee0b2f9ce62304b03415f01610c9026861` (merged PR #28; CI Success).  
**Гілка:** `feat/snapshot-bound-rag-query`.  
**Тип:** інкрементальний план. Загальне магістерське ТЗ і еталонні експерименти ще не завершено.

## Аудит

- `/rag/query` приймає довільний `collectionId`; наявний `getOrCreateCollection` може створити колекцію, якщо її ще немає.
- Пакет 13 ізолював запис в `rag_snapshot_<sha256>`, але перевірка RAG-запитів не пов'язана з corpus snapshot.
- `processRagQuery` уже підтримує явний `collectionId` та надає retrieval metadata, але не перевіряє `corpusSnapshotId` і `reviewStatus` до виклику LLM.

## План

1. Додати **read-only** `getExistingSnapshotCollection` у Chroma client, який не створює колекцію і відхиляє невалідне ім'я.
2. Створити `src/modules/rag/snapshot.query.ts` — сервіс з ін'єкцією залежностей для синтетичних тестів. Усі запити спочатку перевіряють `corpus:snapshot` локально (`loadVerifiedSnapshotIndexPlan`, Python verifier), вимагають точний погоджений `corpusSnapshotId`, а для неповного набору — окремий явний дозвіл. Після цього порівнюють фактичну кількість записів у вже наявній колекції з snapshot chunkCount; ніякого `getOrCreate`.
3. Додати окремий endpoint `POST /rag/query/snapshot`, який читає **лише довірені змінні середовища** `RAG_APPROVED_SNAPSHOT_DIR`, `RAG_APPROVED_SNAPSHOT_ID`, `RAG_ALLOW_PARTIAL_SNAPSHOT`. Параметри `collectionId` і `snapshotDir` у тілі не дозволяються; серверний власник конфігурації має явно погодити корпус.
4. Додати до `RagQueryOptions` internal `expectedSnapshotId`, щоб до генерації LLM відхиляти будь-який retrieved chunk без точного `corpusSnapshotId`, `reviewStatus=approved`, валідного `documentVersion` та номера фізичної сторінки. Результат endpoint містить `corpusSnapshotId`, `collectionId`, `collectionName`, `indexedChunkCount`, `partialSnapshot`.
5. Не змінювати `/rag/query` та `/rag/evaluate` (legacy); пояснити в документації, що безпечні гарантії діють **лише для нового endpoint**, а не глобально.
6. Додати синтетичні тести (без Chroma/Ollama) на відсутність approved snapshot, неповний corpus, відсутню колекцію, count mismatch, неспівпадіння metadata, успішну маршрутизацію і заборону створювати колекцію. Додати CI та протокол.

## Критерії завершення

- Жоден запит до нового endpoint не може вибрати довільну колекцію/директорію через JSON.
- Будь-яка невідповідність metadata джерел або snapshot/collection count викликає помилку **до формування RAG-відповіді**.
- Колекція ніколи не створюється endpoint-ом; її потрібно попередньо індексувати пакетом 13.
- У відповіді й журналі явно вказаний `corpusSnapshotId`; результати зі старого індексу не підміняють дослідницьку вибірку.
- CI синтетичних тестів і збірка frontend зелені; без локального Ollama/Chroma не стверджувати про end-to-end якість.
- Ризики, що лишаються: не перевіряється точне походження **кожного** Chroma-вектора лише за count, і package 13 не прив'язував колекцію до `EMBEDDING_MODEL`. Це вимагає окремої експериментальної конфігурації та інтеграційних тестів.
