# Критичний Windows bugfix для етапу 18 (після PR #33)

**Base:** `main` @ `d0a2da8e5153e8c5c97deb6f2d1270adab4e3d47`, зелений push CI. **Гілка:** `fix/windows-ocr-snapshot-portability`.

## Репродукція від власника (Windows PowerShell, Python 3.14.3, Node 26.13.1)

- `npm.cmd run test:ocr` виводить `Ran 0 tests`; CMD не розуміє одинарні Unix shell quotes у `-p 'test_ocr_*.py'`.
- Прямий `python -m unittest discover -s tests -p "test_ocr_*.py"`: **Ran 19, failures=2, errors=4**.
- Чотири snapshot error `provenance: exported TXT SHA-256 mismatch`: `ocr_review_export.export_to_new_directory` записує текст через `Path.open('x',encoding='utf-8')`, що у Windows перетворює LF на CRLF, всупереч обчисленому SHA-256 вихідного LF UTF-8.
- Окремі negative-case fixtures використовують `Path.write_text(...)` з системною кодуванням (Windows не гарантує UTF-8), через що `json.loads(read_bytes())` відхиляє JSON раніше, ніж очікувані перевірки semantic tampering.

## Мінімальне виправлення

1. `package.json` script `test:ocr`: подвійні лапки у шаблоні, сумісні з CMD і shell.
2. `scripts/ocr_review_export.py`: запис TXT **точними UTF-8 байтами** `text.encode('utf-8')` у `xb`, без системного newline translation; зберегти строгий байтовий SHA-256. Для provenance JSON теж детермінований LF/UTF-8.
3. `scripts/ocr_stage.py`, `scripts/ocr_review_template.py`: зафіксувати LF у нових staging/template JSON для відтворюваних байтових SHA на Windows/Linux.
4. `tests/test_ocr_snapshot.py`: у всіх tamper-фікстурах записувати JSON із `encoding='utf-8'` та `newline='\n'`, не залежати від локальної кодової сторінки Windows.
5. Додати окрему `windows-latest` CI перевірку `npm run test:ocr` на Python 3.14 і Node 22 — CI має виконати справжні 19 тестів, а не повідомити `0 tests`.
6. Перевірити GitHub CI на exact feature HEAD; Merge виконує тільки власник. Немає нової функціональності, gold labels, експертного review або змін у Trust Score.

**Критерій:** same source bytes -> same immutable output bytes on Windows/Linux; 19 tests green; tampering remains fail-closed; Unix tests green. Після merge локально повторити `git pull --ff-only`, `npm.cmd run test:ocr`, `npm.cmd run test:benchmark`.
