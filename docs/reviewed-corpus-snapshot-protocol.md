# Побудова та перевірка незмінного OCR-корпусу — пакет 12

**Призначення:** після **фактичної людської перевірки** PDF-сторінок (пакет 11) сформувати замкнений, відтворюваний дослідницький snapshot, **не змінюючи** `data/university_corpus/`, `data/ingested_corpus.jsonl` або активну ChromaDB-колекцію.

## Передумови та обов'язкові контрольні точки

1. Має існувати оригінальний `data/scrape_manifest.json` **з того самого збирання**, що й джерела. Маніфест містить `documents[].id`, `documentTitle`, `sourceUrl`, `scrapedAt`.
2. Має існувати локальний кеш оригінальних PDF у `data/raw_pdf/`, назви формуються тим самим алгоритмом URL → SHA-1-суфікс, що у скрапері.
3. Для кожного документа: `ocr:review-export` уже створив **окремий** каталог `data/university_corpus_ocr_<id-or-version>/`, що містить рівно `<documentId>.txt` і `<documentId>.provenance.json`.
4. Людина повинна реально підтвердити сторінки та перевірити редакцію. Наявність `reviewerId` або `verifiedDocumentYear` **не доводить**, що це було виконано.

## Команда створення snapshot

```bash
npm run corpus:snapshot -- \
  --manifest data/scrape_manifest.json \
  --raw-pdf data/raw_pdf \
  --reviewed-dir data/university_corpus_ocr_lute_regulations_v1 \
  --reviewed-dir data/university_corpus_ocr_academic_integrity_v1 \
  --output-dir data/corpus_snapshots/reviewed-ocr-v1
```

Імена каталогів у прикладі умовні: використовуйте реальні імена, створені `ocr:review-export`. Кожний `--reviewed-dir` додає рівно один перевірений документ. Команда **не** приймає старий `data/university_corpus/`, підроблену OCR staging-кандидатуру, TXT без provenance або файл з невідповідним PDF SHA-256.

Спочатку вся перевірка виконується в пам'яті. При невідповідності навіть одного документа новий snapshot **не створюється**. Вихідний каталог повинен бути новим під `corpus_snapshots/`; існуючий каталог не перезаписується.

## Зміст нового каталогу

```text
data/corpus_snapshots/reviewed-ocr-v1/
  ingested_corpus.jsonl
  snapshot_manifest.json
```

`snapshot_manifest.json` містить `corpusSnapshotId`, SHA-256 вхідного source manifest і кінцевого JSONL, список документів із SHA-256 PDF, TXT, review provenance, staging і review, їхні редакції, схвалені й виключені сторінки, кількість фрагментів та повноту набору щодо PDF у маніфесті.

Важливо: `completeForPdfManifest: true` означає тільки, що включено **всі PDF-документи з конкретного source manifest**, не що HTML або всі офіційні нормативні документи університету представлені в корпусі. Наявність `false` і `missingPdfDocumentIds` — нормальна ситуація для часткового дослідницького snapshot.

`ingested_corpus.jsonl` містить записи `{text, metadata}` зі стабільними `chunkId`, `documentId`, `documentVersion`, `year` (рік, указаний після ручного перегляду), фізичним `pageNumber`, `section`, `subsection`, `sourcePdfSha256`, `reviewedTextSha256` та `corpusSnapshotId`. Вихідні сторінкові записи в provenance дозволяють звірити кожен chunk з перевіреним текстом.

## Незалежна перевірка створеного snapshot

```bash
npm run corpus:verify -- \
  --snapshot-dir data/corpus_snapshots/reviewed-ocr-v1
```

Перевіряється SHA-256 JSONL, відтворення `corpusSnapshotId`, відповідність кожного фрагмента документу, редакції, PDF-сторінці та розрахованому `chunkId`. Відхиляються дубльовані/невідомі фрагменти та змінені файли.

`corpus:verify` не повторює перевірку вихідного PDF — це робить `corpus:snapshot` при створенні. Обидва інструменти перевіряють **узгодженість артефактів**, а не фактичну незалежність рецензентів чи чинність документів.

## Як не пошкодити попередні результати

- **Не** копіювати JSONL snapshot на `data/ingested_corpus.jsonl` вручну.
- **Не** запускати чинний `npm run index:corpus` як нібито індексацію нового snapshot: сьогодні команда читає **старий фіксований** `data/ingested_corpus.jsonl` і стандартну колекцію ChromaDB.
- Повторний інжестинг та побудова нової колекції ChromaDB із **унікальним ім'ям**, прив'язаним до snapshot, — **окремий пакет 13**. До того часу результати залишаються автономними JSONL-файлами для перевірки.
- Каталог `data/corpus_snapshots/` ігнорується Git. Не комітити приватні фрагменти, оригінали PDF чи ручні оцінки без права на публікацію.

## Автоматизовані тести

```bash
npm run test:ocr
```

Тести працюють лише на **синтетичних вигаданих** документах і перевіряють стабільність SHA-256, порядок документів, зв'язок сторінок із чанками, збереження року перевіреної редакції, відхилення зміненого PDF/TXT, відсутніх документів, неповного корпусу та заборону перезапису. GitHub Actions не має реальних рецензованих PDF, тому він **не** підтверджує фактологічної точності чи готовності gold dataset.
