# Аудит QARAU — 24 сентября 2026

**Вывод: текущую рабочую копию нельзя считать готовой к сквозному запуску integrated pipeline и выдаче достоверно проверенных исследований.** Найдены 14 дефектов: 7 уровня P1 и 7 уровня P2. Восемь воспроизведены на синтетических данных; остальные подтверждены статическим прослеживанием кода и конфигурации. Это аудит реализации, а не свидетельство произошедшей утечки или атаки.

P1 — исправить до выпуска: нарушение приватности, корректности исследования или основной функции. P2 — существенная ошибка восстановления, защиты или пользовательского сценария. P0 в проверенном объёме не выявлен; это не гарантия отсутствия иных уязвимостей.

## Объём и ограничения

Проверена рабочая копия HEAD `0734212`, включая уже существовавшие незакоммиченные изменения. Исходники приложения не исправлялись. Добавлены только этот отчёт, диагностический сценарий и журналы в `docs/audits/2026-09-24/`.

Покрытие: маршруты legacy/integrated API; owner auth, CSRF и SIWS; публичные проекции; очередь и обработчики discovery/scrape/analysis/chain; scheduler; PostgreSQL migrations/repositories/roles; S3; нормализация и количественная модель; egress и AI; signer, RPC client, Anchor account constraints и escrow; Compose; React admin/public/wallet flows.

Не выполнены: браузерный E2E с кошельком, интеграционные проверки реального PostgreSQL/MinIO, транзакции Devnet/local validator, проверка соответствия развёрнутой программы исходникам, восстановление резервной копии, нагрузочные и сетевые атаки. Docker Engine недоступен. Секреты и содержимое реальных приватных артефактов для аудита не читались.

## Проверки

| Проверка | Результат |
|---|---|
| Node / npm | 24.18.0 / 11.16.0 |
| `npm run build` | Успешно: TypeScript и Vite |
| `npm run lint` | Успешно |
| `npm test` | 97 тестов: 89 pass, 8 skipped, 0 fail |
| `npm run test:anchor` | 10 pass; host unit tests, не исполнение транзакций в validator |
| `npm run test:integration` | Не запущены тесты: недоступен pipe dockerDesktopLinuxEngine |
| `npm audit --json` | 0 известных уязвимостей по ответу registry на момент проверки |
| `node docs/audits/2026-09-24/reproduce.mjs` | Восемь диагностических воспроизведений успешны |

Диагностический сценарий намеренно утверждает наличие текущих дефектов: его успешное выполнение **не означает исправность системы**. Он использует mock-пулы, синтетические артефакты и временные HTTP-серверы на loopback. RPC-запросов, реальных подписей и операций с рабочей БД нет.

## P1 — исправить до выпуска

### F01. Любая публикация через API отклоняется из-за версии задания

**Код:** [server/api/v1.mjs:291](<C:/Users/BIGra/Desktop/solana workshop mvp/server/api/v1.mjs:291>), [server/jobs/queue.mjs:27](<C:/Users/BIGra/Desktop/solana workshop mvp/server/jobs/queue.mjs:27>), [server/jobs/payloads.mjs:12](<C:/Users/BIGra/Desktop/solana workshop mvp/server/jobs/payloads.mjs:12>).

API вычисляет idempotency key для `chain.publish` версии 2, но не передаёт `payloadVersion: 2` в `enqueue`. Значение по умолчанию — 1; `parseJobPayload` немедленно выбрасывает `unsupported_job_payload_version`.

**Эффект:** валидный sealed package получает HTTP 400, задание не попадает в БД, signer не вызывается. Воспроизведено через настоящий Express router с mock persistence; insert jobs не выполнялся.

**Исправление:** передавать версию явно либо централизованно брать её из JOB_PAYLOADS. Добавить HTTP-проверку publish → persisted v2 job, а не только отдельный тест схемы payload.

### F02. Публичные метаданные автоматически раскрывают приватный источник

**Код:** [server/api/v1.mjs:265](<C:/Users/BIGra/Desktop/solana workshop mvp/server/api/v1.mjs:265>), [server/api/v1.mjs:49](<C:/Users/BIGra/Desktop/solana workshop mvp/server/api/v1.mjs:49>).

При sealing без явного описания `description` копируется из sources; title по умолчанию тоже берётся из sources. В `validation_summary` помещается внутренний `analysis_run_id`. Все эти поля проходят публичный allowlist. Фильтрация только имён полей не делает их содержимое безопасным.

**Эффект:** после публикации посетитель без owner/wallet auth получает название, описание, потенциальный URL источника и ID исследования. Это противоречит заданной границе приватности. Даже UI с явно указанным нейтральным title не устраняет fallback для description.

**Доказательство:** синтетический source title и URL из description прошли sealing и публичную проекцию. Состояние committed для проверки проекции задано mock-пулом; реальной публикации не было.

**Исправление:** нейтральные безопасные defaults, отдельный контракт публичного текста без копирования source metadata, удалить внутренний analysis ID из публичного summary. Проверять значения и вложенные структуры.

### F03. AI_SAFE передаёт идентифицирующий свободный текст внешнему AI

**Код:** [server/analyzers/index.mjs:44](<C:/Users/BIGra/Desktop/solana workshop mvp/server/analyzers/index.mjs:44>), [server/jobs/handlers/analysis-run.mjs:55](<C:/Users/BIGra/Desktop/solana workshop mvp/server/jobs/handlers/analysis-run.mjs:55>).

`aiSafeRepresentation` напрямую копирует `private.summary` или `measurementDescription` в `sourceText`. Integrated analysis заполняет summary из source.description/title и принудительно устанавливает `sensitivityMode: PUBLIC_SOURCE`. Ограничение длины не обезличивает текст.

**Условие:** включён `AI_PROVIDER=openai-compatible`; по умолчанию local mode не отправляет запросов.

**Эффект:** названия, URL и другие детали из исходного описания могут уйти внешнему провайдеру. Схема ответа AI не защищает исходящий запрос.

**Доказательство:** диагностический вызов AI-safe mapper сохранил синтетическое имя и URL целиком; внешний запрос не выполнялся.

**Исправление:** строить запрос из действительно ограниченных категорий/обобщений, исключить raw summary, хранить и соблюдать политику чувствительности источника вместо безусловного PUBLIC_SOURCE.

### F04. Test-выборка используется для выбора лучшего сигнала

**Код:** [server/analysis/quantitative.mjs:116](<C:/Users/BIGra/Desktop/solana workshop mvp/server/analysis/quantitative.mjs:116>), [server/analysis/quantitative.mjs:157](<C:/Users/BIGra/Desktop/solana workshop mvp/server/analysis/quantitative.mjs:157>), [server/analysis/quantitative.mjs:172](<C:/Users/BIGra/Desktop/solana workshop mvp/server/analysis/quantitative.mjs:172>).

Каждый вариант transformation × lag × horizon получает score, включающий test IC с весом 0.3. Затем `best` выбирается по максимуму этого score. Поэтому публикуемые test-метрики уже участвовали в выборе победителя и не являются независимой итоговой оценкой.

Дополнительно `strategyMetrics` считает порог позиции как медиану всей оцениваемой выборки, включая будущие относительно каждой сделки наблюдения. При horizon > 1 соседние forward labels пересекают границы train/validation/test: purge отсутствует.

**Эффект:** заявленная leakage-safe out-of-sample проверка не обеспечена; метрики могут быть оптимистичны.

**Исправление:** выбирать конфигурацию на train/validation, фиксировать preprocessing и стратегию до test, вычислять test один раз для выбранного варианта; разделять выборки по интервалам labels, учитывать горизонт. Проверять, что изменение только holdout не меняет выбранную конфигурацию. Оценить также формулу p-value и отсутствие поправки q-value на множественный перебор.

### F05. Производный сигнал получает время доступности раньше своих входов

**Код:** [server/analysis/quantitative.mjs:53](<C:/Users/BIGra/Desktop/solana workshop mvp/server/analysis/quantitative.mjs:53>), [server/analysis/quantitative.mjs:58](<C:/Users/BIGra/Desktop/solana workshop mvp/server/analysis/quantitative.mjs:58>), [server/ingestion/parsers.mjs:120](<C:/Users/BIGra/Desktop/solana workshop mvp/server/ingestion/parsers.mjs:120>).

Delta, percent change и rolling-преобразования используют прошлые наблюдения, но получают только availableAt текущей строки. Если прошлое наблюдение опубликовано позднее, производная объявляется доступной до появления одного из необходимых входов.

**Доказательство:** значение за 1 января, доступное только 5 января, участвует в delta за 2 января; выход помечен доступным 2 января. Это воспроизведено вызовом `constructSignals`.

Дополнительный риск той же временной модели: при отсутствии/невалидности publication timestamp parser заменяет его observation timestamp. Источники с неизвестной задержкой автоматически выглядят доступными мгновенно.

**Исправление:** availableAt производной должен быть максимумом времён доступности всех входов. Неизвестную задержку хранить явно, применять проверенную release policy либо блокировать соответствующую оценку.

### F06. Покупателю derived-only выдаётся случайный кандидат вместо исследованного best

**Код:** [server/api/v1.mjs:115](<C:/Users/BIGra/Desktop/solana workshop mvp/server/api/v1.mjs:115>), [server/api/v1.mjs:140](<C:/Users/BIGra/Desktop/solana workshop mvp/server/api/v1.mjs:140>), [server/api/v1.mjs:444](<C:/Users/BIGra/Desktop/solana workshop mvp/server/api/v1.mjs:444>).

Для derived artifact используется `ORDER BY candidate.id LIMIT 1`: выбор по UUID не связан с `report.best`, source_column, transformation или score. Это происходит и для обычного, и для delayed доступа.

**Эффект:** отчёт и показатели описывают лучший сигнал, а скачиваемые/показываемые значения могут относиться к другой трансформации или полю. Это особенно существенно при лицензии только на derivative data.

**Подтверждение:** статическая цепочка query → deliverable_object_key → dataset/view/export. В БД не зафиксирована используемая здесь связь с best candidate.

**Исправление:** сохранять ID выбранного кандидата и его artifact hash при завершении анализа; sealing и delivery должны ссылаться именно на него. Проверить кейс с двумя кандидатами, где UUID order противоположен рейтингу.

### F07. worker-chain в Compose изолирован от Devnet RPC

**Код:** [compose.yaml:5](<C:/Users/BIGra/Desktop/solana workshop mvp/compose.yaml:5>), [compose.yaml:183](<C:/Users/BIGra/Desktop/solana workshop mvp/compose.yaml:183>), [server/jobs/handlers/chain-settle.mjs:25](<C:/Users/BIGra/Desktop/solana workshop mvp/server/jobs/handlers/chain-settle.mjs:25>), [server/jobs/handlers/chain-reconcile.mjs:24](<C:/Users/BIGra/Desktop/solana workshop mvp/server/jobs/handlers/chain-reconcile.mjs:24>).

worker-chain наследует только сеть `private`, объявленную `internal: true`. При этом он сам вызывает внешний SOLANA_RPC_URL при settlement и reconciliation. У publisher-signer есть сеть egress, но успешный запрос к signer не даёт сетевого доступа самому worker.

**Эффект:** стандартная Compose-топология не обеспечивает reconcile/завершение settlement. После успешной on-chain операции локальное состояние может остаться ended, а API claim требует settled/access_granted.

**Подтверждение:** статическое сопоставление topology и вызовов; сетевое воспроизведение заблокировано отсутствующим Docker Engine.

**Исправление:** добавить контролируемый RPC egress worker-chain либо вынести все RPC-чтения в доступный ему сервис. Проверить реальный compose settlement → local cache → claim.

## P2 — восстановление, защита и пользовательские сценарии

### F08. Повтор анализа после ошибки или падения worker не восстанавливается

**Код:** [server/jobs/handlers/analysis-run.mjs:44](<C:/Users/BIGra/Desktop/solana workshop mvp/server/jobs/handlers/analysis-run.mjs:44>), [server/jobs/handlers/analysis-run.mjs:115](<C:/Users/BIGra/Desktop/solana workshop mvp/server/jobs/handlers/analysis-run.mjs:115>).

Handler принимает только queued (кроме уже завершённых результатов). Ошибка S3/AI/БД переводит run в failed; аварийное завершение оставляет running. Повторная доставка очередью в обоих случаях получает analysis_run_not_queued. Частично созданные candidates/results записываются поэтапно, без атомарного завершения.

**Доказательство:** redelivery для обоих состояний воспроизведена. Восстановление реальных частичных DB-записей не тестировалось.

**Исправление:** безопасный claim/resume по attempt/lease, идемпотентные вставки или staging и транзакционное завершение; согласовать retry очереди и analysis_runs.

### F09. Падение на последней попытке оставляет job навечно running

**Код:** [server/jobs/queue.mjs:62](<C:/Users/BIGra/Desktop/solana workshop mvp/server/jobs/queue.mjs:62>), [server/jobs/queue.mjs:157](<C:/Users/BIGra/Desktop/solana workshop mvp/server/jobs/queue.mjs:157>), [server/runtime/worker-entry.mjs:65](<C:/Users/BIGra/Desktop/solana workshop mvp/server/runtime/worker-entry.mjs:65>).

claim исключает attempts >= max_attempts даже при истёкшем lease. Метод recoverExpired умеет переводить такие записи в dead_letter, но не вызывается production worker/scheduler. Поиск использования в server вне тестов нашёл только определение.

**Эффект:** job остаётся running бессрочно. Для scrape это ещё и блокирует будущие автоматические задания: listDue исключает источник с running job.

**Исправление:** регулярно вызывать recoverExpired с согласованными блокировками или включить terminal recovery в claim. Проверить падение на последней попытке.

### F10. Знак ориентации дважды применяется к holdout IC

**Код:** [server/analysis/quantitative.mjs:92](<C:/Users/BIGra/Desktop/solana workshop mvp/server/analysis/quantitative.mjs:92>), [server/analysis/quantitative.mjs:157](<C:/Users/BIGra/Desktop/solana workshop mvp/server/analysis/quantitative.mjs:157>).

strategyMetrics уже возвращает IC × orientation. Компонент out_of_sample умножает его на orientation ещё раз. Сильный устойчивый отрицательно коррелированный сигнал теряет баллы после корректного разворота стратегии; сменивший знак может оцениваться неверно.

**Доказательство:** две эквивалентные после ориентации стратегии дали одинаковый test IC, но компонент score равен 100 и 0.

**Исправление:** применять ориентацию один раз. Проверить симметрию сигнала X и -X и смену знака на holdout.

### F11. Проверка Devnet обходится строкой запроса URL

**Код:** [server/runtime/config.mjs:37](<C:/Users/BIGra/Desktop/solana workshop mvp/server/runtime/config.mjs:37>), [server/signer/publisher.mjs:42](<C:/Users/BIGra/Desktop/solana workshop mvp/server/signer/publisher.mjs:42>).

Регулярное выражение ищет devnet/localhost/127.0.0.1 где угодно в URL. `https://api.mainnet-beta.solana.com/?devnet` принимается конфигурацией и соответствует аналогичной проверке signer.

**Доказательство:** config принял этот mainnet hostname; сетевого запроса и подписи не было.

**Эффект:** ошибка конфигурации либо доступ к deployment settings может снять заявленную защиту «Devnet only». Это не удалённый неавторизованный выбор RPC через API.

**Исправление:** проверять разобранный hostname и разрешённые endpoints; перед подписанием удостоверять сеть по genesis hash. Не считать вхождение слова в URL идентичностью сети.

### F12. Disconnect кошелька не завершает SIWS-сессию

**Код:** [src/pages/MyAccess.tsx:130](<C:/Users/BIGra/Desktop/solana workshop mvp/src/pages/MyAccess.tsx:130>), [server/api/v1.mjs:370](<C:/Users/BIGra/Desktop/solana workshop mvp/server/api/v1.mjs:370>), [server/wallet/siws.mjs:96](<C:/Users/BIGra/Desktop/solana workshop mvp/server/wallet/siws.mjs:96>).

UI отключает extension и очищает часть React state, но не вызывает существующий server logout. HttpOnly session cookie остаётся действительным до idle/absolute expiry. delivered тоже не очищается при disconnect.

**Эффект:** прямые запросы браузера к protected dataset продолжают проходить после видимого отключения. Старые данные могут остаться в памяти и появиться при следующем подключении, если refresh нового wallet завершится ошибкой.

**Исправление:** вызывать wallet logout, очищать delivered и остальные wallet states; обрабатывать account-change и session expiry. Проверить protected API после disconnect.

### F13. Возврат ставки не отражается в PostgreSQL и UI

**Код:** [src/pages/MyAccess.tsx:143](<C:/Users/BIGra/Desktop/solana workshop mvp/src/pages/MyAccess.tsx:143>), [server/api/v1.mjs:424](<C:/Users/BIGra/Desktop/solana workshop mvp/server/api/v1.mjs:424>), [server/api/v1.mjs:436](<C:/Users/BIGra/Desktop/solana workshop mvp/server/api/v1.mjs:436>).

После refund UI лишь вызывает refreshPrivate. Endpoint выдаёт unsigned transaction; подтверждения refund нет. Auction positions читаются из auction_bids, а handler reconciliation обновляет только access_rounds. Производственного обновления auction_bids.status = refunded не найдено.

**Эффект:** успешно возвращённая ставка продолжает отображаться active/loser; кнопки предлагают повторный refund/claim, хотя Bid PDA уже закрыт on-chain.

**Исправление:** добавить верифицированное подтверждение refund или reconciliation Bid/transaction state с идемпотентным обновлением cache. Сохранять signature до завершения подтверждения.

### F14. Подмена X-Forwarded-For обходит owner login throttling при прямом доступе

**Код:** [server/index.mjs:26](<C:/Users/BIGra/Desktop/solana workshop mvp/server/index.mjs:26>), [server/auth.mjs:85](<C:/Users/BIGra/Desktop/solana workshop mvp/server/auth.mjs:85>), [compose.yaml:111](<C:/Users/BIGra/Desktop/solana workshop mvp/compose.yaml:111>).

Express безусловно доверяет одному proxy hop, throttle использует req.ip. Compose публикует API напрямую на 8787 без обязательного доверенного reverse proxy, поэтому клиент сам задаёт адрес через X-Forwarded-For.

**Доказательство:** пять ошибок приводят к 429, смена только X-Forwarded-For возвращает 401 и разрешает новую попытку.

**Исправление:** отключить trust proxy при прямом доступе; за proxy доверять только его адресам и исключить обход proxy. Добавить общий ограничитель нагрузки на login. Проверить реальную deployment topology.

## Дополнительные риски и пробелы проверки

Эти пункты не входят в счётчик 14 основных дефектов, но требуют отдельной проверки:

- **Целостность артефактов:** getVerifiedBytes существует, однако analysis и delivery читают через getStream. Proof endpoint сравнивает DB hashes с on-chain, а не заново вычисленный hash фактически выдаваемых байтов. Для end-to-end integrity нужны сверка байтов, domain hash и связи с commitment; при повреждении хранилища текущая выдача может не обнаружить расхождение.
- **Повторная публикация:** signer пропускает создание уже существующего commitment/round без сравнения всех его полей с input. В БД уникальность dataset_pda препятствует обычному дублированию, но retry после частичного успеха с изменёнными auction terms требует отдельного E2E-теста на совпадение local и on-chain.
- **Kill switches и документация:** SECURITY.md описывает в основном legacy Memo runtime, включая отсутствие export и ежедневный лимит signer. Integrated API содержит export; интегрированный signer не использует legacy enforceDailyLimit. Нельзя переносить гарантии legacy на integrated без проверки. DISABLE_CRAWLING проверяется в legacy service, но не в прочитанном integrated scrape handler.
- **Минимальные права:** DB role contracts запрещают signer key вне signer, но DEFAULT PRIVILEGES дают широкие права на все таблицы; это не изоляция каждого worker по данным. Compose использует демонстрационные credentials, выключенный S3 SSE и COOKIE_SECURE=false — такая конфигурация требует отдельного production-профиля.
- **Наблюдаемость:** worker health возвращает ready без проверки БД; исключение claim вне обработчика job может завершить процесс. SIWS nonce/session retention и ограничения публичных запросов требуют нагрузочной проверки.
- **Контракт аукциона:** лимит 32 bids и permissionless wallets допускают заполнение раунда множеством кошельков. Это продуктовый/экономический риск bounded auction, не доказательство обхода Anchor ownership. Проверены исходные constraints, но не выполнены adversarial validator tests.
- **Тестовое покрытие:** зелёные tests преимущественно проверяют отдельные функции. Нет подтверждённого сквозного прогона discover → ingest → analyze → seal → publish → bid → settle → claim/refund → delivery, который бы выявил F01/F07.
- **Локальный режим:** интерфейс admin теперь использует v1, а обычный npm run dev по умолчанию legacy без v1. Это необходимо явно отразить в инструкциях запуска, иначе отсутствие данных легко принять за исправность pipeline.

## Порядок исправления и критерий завершения

1. F01 + F07: восстановить работоспособную публикацию и settlement в isolated integration environment.
2. F02 + F03: закрыть автоматический перенос идентифицирующего текста в public/AI.
3. F04 + F05 + F10: исправить статистический контракт, повторно вычислить результаты; существующие оценки не объявлять независимым holdout.
4. F06: связать delivered artifact с выбранным кандидатом.
5. F08 + F09: проверить fault injection на разных точках записи и последней попытке.
6. F11 + F14: закрыть обход конфигурационных защит.
7. F12 + F13: проверить logout, account switching и refund в браузере с Devnet wallet.
8. Запустить PostgreSQL/MinIO integration, validator transaction tests и полный E2E. После исправлений повторить аудит затронутых цепочек.

## Материалы

- [Воспроизводимый диагностический сценарий](reproduce.mjs)
- [Вывод воспроизведений](reproduction.log)
- [Node tests](audit-tests.log)
- [Anchor tests](audit-anchor.log)
- [Причина блокировки integration](audit-integration.log)
- [Ответ npm audit](audit-dependencies.json)

