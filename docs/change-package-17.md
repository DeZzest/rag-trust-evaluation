# Пакет 17 — завершальна експериментальна модель Trust Score і feature freeze

**База:** `main` @ `511f61a13d31ea17f53db57bbc3047b3061d333a` (PR #31 merged, CI Success).  
**Гілка:** `feat/claim-aware-trust-experiment-final`.  
**Ціль:** мінімально достатня завершеність програмної частини магістерського дослідження.

## Мотивація

- Наявний `calculateTrustScore({mode:"lightweight"})` використовує retrieval quality і формальні цитати (0.60/0.25/0.15). Цитата і буквальна наявність фрази **не означають семантичне підтвердження**.
- Модуль `evaluateClaimGrounding` уже повертає атомарні LLM-verdict `supported|contradicted|unsupported|uncertain`, але ці результати **не впливають на Trust Score**.
- Для магістерської роботи потрібні два оцінювачі на **тих самих відповідях** і контрольований експеримент, а не нові інфраструктурні підсистеми.

## Мінімальна реалізація

1. Створити чистий `src/modules/rag/claim.aware.score.ts`: приймає *baseline* lightweight score, реальний `ClaimGroundingResult`, перевіряє counts, і повертає experimental score/пояснюваний breakdown або `status:unavailable,score:null`.
2. **Попередньо зафіксована і прозора робоча формула, до реальних експериментів:** `S_candidate = min(1, max(0, 0.65*S_baseline + 0.35*(supported/totalClaims)))`; штрафні caps за хоча б один LLM-verdict `contradicted: 0.25`, `unsupported: 0.50`, `uncertain: 0.70`. Якщо одночасно є кілька категорій — найсуворіше обмеження. Формула **кандидатна**, не емпірично підтверджена і не переналаштовується на test split.
3. `processRagQuery`: за `includeClaimGrounding:true` розраховувати експериментальний `trust.claimAware` **після** вже наявної claim grounding перевірки; при відмові LLM не підставляти нуль/півбал або baseline, а `score:null`. Головний `trust.score` лишається baseline, щоб не змінити історичний API та коректність порівняння.
4. У результатах повернути baseline, candidate, підстави caps, частки `supported/contradicted/unsupported/uncertain` і `status`; не плутати окремі метрики з експертно підтвердженими.
5. Додати синтетичні тести на всі підтримані/суперечливі/без цитат/змішані/порожні/невалідні counts і unavailable, збереження baseline та один із явних вердиктів.
6. Додати CI, короткий експериментальний протокол dev/test, абляція (baseline vs candidate), модельні обмеження; `docs/thesis-minimal-technical-spec.md` поки **не** міняти з draft на approved, доки власник не зафіксує письмову згоду з файлом.
7. Після приймання PR — **фіксація функціоналу**. Далі тільки реальний підкорпус, експертна розмітка, інтеграційні тести, результати й текст дисертації; додаткові функції тільки для блокувальних дефектів.

## Обмеження і ризики

- Verdict формує LLM, а `evidenceQuote` перевіряється як буквальний підрядок; ця перевірка **не доводить** семантичного entailment. Candidate score — гіпотеза для перевірки, **не** ймовірність істинності.
- Наявний claim extraction може пропускати твердження; `totalClaims` — кількість виявлених, а не гарантоване повне покриття відповіді.
- Ваги та caps — прозоре стартове припущення. Будь-яка подальша настройка лише на dev до фіксації evaluation protocol; не підбирати їх під test.
- Для реально відтворюваної наукової оцінки все ще потрібні OCR і перевірка документа, gold annotations, моделі Ollama/Chroma, порівняльні журнали.

## Критерії приймання

- Звичайний `/rag/query` без claim grounding повертає незмінний baseline Trust Score.
- Коли `includeClaimGrounding:true` і LLM verdict доступний, у тій самій відповіді є baseline і **окремий** candidate score з caps.
- Коли verdict unavailable, candidate score має `null`, issue зберігається; baseline не переписується.
- Жодних фіктивних експертних метрик чи висновків про приріст точності; CI повністю зелений.
