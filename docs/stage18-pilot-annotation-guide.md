# Етап 18: пілотний реальний підкорпус — перевірка та розмітка

**Статус:** реальні вихідні PDF, але редакції та тексти НЕ перевірені людиною; 29 україномовних запитань — лише кандидати, НЕ готовий gold.

Обрано 3 PDF із переданого власником архіву: документ про мову освітнього процесу (2 стор.), документ про робочі групи освітніх програм (9 стор.), документ про організацію методичної роботи (17 стор.). Разом **28 фізичних сторінок**, тоді як вихідний manifest має 21 PDF. Усі 3 PDF мають доступний текстовий шар на більшості сторінок. OCR може знадобитися для окремих нетекстових сторінок. Збережені SHA-256 і URL: data/benchmark/pilot-source-selection.json.

## A. Підготувати репозиторій — Windows PowerShell (після Merge PR #33)

Якщо проєкту немає на комп'ютері:

~~~powershell
git clone https://github.com/DeZzest/rag-trust-evaluation.git
cd rag-trust-evaluation
~~~

Якщо репозиторій вже є, відкрий PowerShell у його корені. Потім:

~~~powershell
git checkout main
git pull --ff-only origin main
npm ci
python --version
tesseract --list-langs
pdfinfo -v
npm run test:ocr
npm run test:benchmark
~~~

Потрібні Node.js LTS, Python 3.10+, Poppler (pdfinfo/pdftotext/pdftoppm) та Tesseract з мовами **ukr + eng** у PATH. Ollama і ChromaDB тут поки не потрібні.

## B. Отримати 3 вихідні PDF без перезапису старого корпусу

Завантажити з цієї розмови stage18_pilot_3pdf_sources.zip (три PDF і оригінальний scrape_manifest.json); зберегти у Downloads. Не класти ZIP до Git.

~~~powershell
Expand-Archive -LiteralPath "$HOME\Downloads\stage18_pilot_3pdf_sources.zip" -DestinationPath ".\data\pilot_stage18_inputs"
Get-ChildItem ".\data\pilot_stage18_inputs\raw_pdf" -Filter *.pdf
Get-FileHash ".\data\pilot_stage18_inputs\raw_pdf\movavuklad_384ea4eb86823c.pdf" -Algorithm SHA256
~~~

Останній SHA-256 повинен бути:
bb66e1d6608569e65b482e00d430e7f264b4213d559ada516577c31f60ac9fd2

Каталог data/pilot_stage18_inputs/ ігнорується Git. **Не змінювати** старий data/raw_pdf, data/university_corpus та data/ingested_corpus.jsonl.

## C. Перша проста перевірка — двосторінковий документ №7

~~~powershell
npm run ocr:stage -- --manifest data/pilot_stage18_inputs/scrape_manifest.json --raw-pdf data/pilot_stage18_inputs/raw_pdf --document-id lute_regulations_2026_pdf_7
npm run ocr:review-template -- --staging data/ocr_staging/lute_regulations_2026_pdf_7.ocr.json --output data/ocr_review/lute_regulations_2026_pdf_7.review.json
~~~

Очікувано: OCR staging із 2 сторінками та complete:true, а шаблон перевірки — з 2 рішеннями pending. Це не підтвердження правильності тексту.

**Тут зупинитися для фактичного перегляду PDF.** Кожну сторінку необхідно особисто звірити з оригіналом. У review-файлі вручну заповнити reviewerId, reviewedAt у форматі ISO 8601 із часовою зоною, reviewNote та decision (approved/excluded). Для approved явно записати reviewedText, який відповідає оригіналу; для excluded видалити reviewedText. Окремо перевірити редакцію документа та заповнити documentVersion, verifiedDocumentYear, versionEvidenceNote, versionReviewerId, category: regulations. **Рік 2026 в імені файла не доводить чинності.** Якщо редакція не перевірена, експорт не виконувати.

## D. Ще два документи — після вдалої першої проби

~~~powershell
npm run ocr:stage -- --manifest data/pilot_stage18_inputs/scrape_manifest.json --raw-pdf data/pilot_stage18_inputs/raw_pdf --document-id lute_regulations_2026_pdf_11
npm run ocr:stage -- --manifest data/pilot_stage18_inputs/scrape_manifest.json --raw-pdf data/pilot_stage18_inputs/raw_pdf --document-id lute_regulations_2026_pdf_17
npm run ocr:review-template -- --staging data/ocr_staging/lute_regulations_2026_pdf_11.ocr.json --output data/ocr_review/lute_regulations_2026_pdf_11.review.json
npm run ocr:review-template -- --staging data/ocr_staging/lute_regulations_2026_pdf_17.ocr.json --output data/ocr_review/lute_regulations_2026_pdf_17.review.json
~~~

Документ №11 містить ознаку «Положення СУЯ – 2022», №17 — «Положення СУЯ – 2023», але ці написи не підтверджують актуальність редакцій. В оригінальному manifest для №17 виявлено помилковий/загальний заголовок, що не збігається з фактичною назвою PDF. Цю розбіжність потрібно задокументувати до остаточного експорту.

## E. Лише після реального підтвердження всіх 28 сторінок

~~~powershell
npm run ocr:review-export -- --staging data/ocr_staging/lute_regulations_2026_pdf_7.ocr.json --review data/ocr_review/lute_regulations_2026_pdf_7.review.json --pdf data/pilot_stage18_inputs/raw_pdf/movavuklad_384ea4eb86823c.pdf --output-dir data/university_corpus_ocr_language_v1
npm run ocr:review-export -- --staging data/ocr_staging/lute_regulations_2026_pdf_11.ocr.json --review data/ocr_review/lute_regulations_2026_pdf_11.review.json --pdf data/pilot_stage18_inputs/raw_pdf/polog_proektni_grypu_31ce9fbe63ce30.pdf --output-dir data/university_corpus_ocr_workgroups_v1
npm run ocr:review-export -- --staging data/ocr_staging/lute_regulations_2026_pdf_17.ocr.json --review data/ocr_review/lute_regulations_2026_pdf_17.review.json --pdf data/pilot_stage18_inputs/raw_pdf/20_polozhennja_pro_organizaciju_metodichnoji_roboti_v_lteu_040ddf173d6da8.pdf --output-dir data/university_corpus_ocr_methodology_v1
~~~

Всі вихідні каталоги повинні бути новими: CLI не перезаписує готові review-експорти.

## F. Зібрати й перевірити snapshot реального підкорпусу

~~~powershell
npm run corpus:snapshot -- --manifest data/pilot_stage18_inputs/scrape_manifest.json --raw-pdf data/pilot_stage18_inputs/raw_pdf --reviewed-dir data/university_corpus_ocr_language_v1 --reviewed-dir data/university_corpus_ocr_workgroups_v1 --reviewed-dir data/university_corpus_ocr_methodology_v1 --output-dir data/corpus_snapshots/pilot_v1
npm run corpus:verify -- --snapshot-dir data/corpus_snapshots/pilot_v1
~~~

Очікувано: documentCount=3, completeForPdfManifest=false (частковий корпус проти 21 PDF). Зберегти corpusSnapshotId із snapshot_manifest.json. НІКОЛИ не підміняти ним старий ingested_corpus.jsonl і не запускати legacy index:corpus.

## G. Підготувати 29 запитань до справжньої експертної розмітки

~~~powershell
npm run benchmark:prepare -- data/corpus_snapshots/pilot_v1/ingested_corpus.jsonl data/benchmark/pilot-eval-queries.json data/benchmark/annotation-queue-pilot.json
npm run benchmark:audit -- data/corpus_snapshots/pilot_v1/ingested_corpus.jsonl data/benchmark/annotation-queue-pilot.json data/benchmark/corpus-readiness-pilot.json
~~~

У черзі має бути 29 cases зі статусом needs_manual_annotation та **саме той corpusSnapshotId**, що у snapshot_manifest.json. Candidate source ≠ релевантне gold evidence. Тексти джерел і сторінкові підказки необхідно перевірити вручну. Чотири контрольних питання містять заперечення/вихід за межі підкорпусу.

Тільки після двох справді незалежних людських оцінок та окремого погодження можна оформити annotation-review/1, створити gold:

~~~powershell
npm run benchmark:adjudicate -- data/benchmark/annotation-queue-pilot.json data/benchmark/annotation-review-pilot.json data/benchmark/gold-pilot-v1.json
npm run benchmark:validate -- data/benchmark/gold-pilot-v1.json
~~~

Коли другого анотатора немає, не заявляти подвійного gold і не вигадувати оцінки. Погодити чесне обмеження з керівником роботи.

## H. Що надіслати мені для першої перевірки

Достатньо результатів команд npm run test:ocr, npm run test:benchmark, ocr:stage та ocr:review-template **лише для документа №7**, плюс повідомлення про розбіжності між двома сторінками PDF і текстом. За бажанням можна надіслати його кандидатний OCR JSON (якщо передача тексту дозволена).

Не надсилати парольні файли, приватні персональні дані й не комітити людські розмітки в публічний Git. Після успішної проби допоможу з рештою 26 сторінок та підготовкою gold без фабрикації результатів.

**Статус етапу 18 до перевірки PDF, рецензій і gold: підготовлено джерела/чергу, ручне приймання очікується.**
