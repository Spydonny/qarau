# Деплой QARAU API на Fly.io

Команды запускаются из корня репозитория. `fly.toml` выбирает API-only
`server/Dockerfile`, порт `8080` и приложение `server-hidden-canyon-2603`.
Приложение работает в `integrated`-режиме: записи и приватные артефакты
хранятся в MongoDB. Образ не содержит собранный React-интерфейс.

## Первый запуск

Приложение уже создано, а том `qarau_private` объёмом 1 ГБ уже подключён в
регионе `arn`. Для нового приложения том нужно создать до деплоя:

```powershell
fly volumes create qarau_private -a <имя-приложения> -r arn --size 1 --yes
```

Том сохраняет архивное состояние legacy-режима. Данные integrated-режима
хранятся в MongoDB.

## Пароль владельца

Создайте хеш и сохраните **только** часть после `OWNER_PASSWORD_HASH=` как
секрет Fly:

```powershell
npm run auth:hash -- 'ваш-пароль'
fly secrets set OWNER_PASSWORD_HASH='<salt:hash>' -a server-hidden-canyon-2603
```

Пока секрет не задан, сервер при запуске создаёт временный пароль и пишет его
в логи. После перезапуска этот пароль меняется.

## Деплой и проверка

```powershell
fly deploy --remote-only --ha=false --yes
fly status -a server-hidden-canyon-2603
fly volumes list -a server-hidden-canyon-2603
```

Проверьте `https://server-hidden-canyon-2603.fly.dev/api/health`: ожидается
HTTP 200 и `"mode":"integrated"`. Затем проверьте `/api/v1/opportunities`:
ожидается HTTP 200 и JSON с массивом `packages`. `--ha=false` не создаёт запасной экземпляр
при новом развёртывании; текущий масштаб также установлен в одну машину.
Проверка здоровья Fly использует тот же путь.

Для диагностики запуска:

```powershell
fly logs -a server-hidden-canyon-2603
```

## Отдельный фронтенд

Если фронтенд обращается к API с другого origin, настройте `ALLOWED_ORIGIN`
как секрет Fly. Для разрешённого origin и HTTPS сервер выдаёт cookie
`SameSite=None; Secure`; запросы владельца по-прежнему требуют CSRF-токен.

## MongoDB

Для `/api/v1` требуются `MONGODB_URI`, `MONGODB_DB`,
`SOURCE_URL_ENCRYPTION_KEY` и `WALLET_SESSION_SECRET`. Публичные адрес RPC и
идентификатор программы заданы в `fly.toml`. Команда `npm run db:migrate`
идемпотентно создаёт коллекции и индексы MongoDB. `ARTIFACT_STORE=mongodb`
хранит приватные байты порциями и проверяет их хеш при чтении.

```powershell
fly secrets set MONGODB_URI='mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority'
fly secrets set MONGODB_DB='qarau'
```

Запустите `npm run db:migrate` там, где задан `MONGODB_URI`; команда не читает
секреты Fly автоматически. Для входа владельца задайте `OWNER_PASSWORD_HASH`
через `fly secrets set` — приложение не использует переменную
`ADMIN_CREDENTIALS`.

Импорт из старого зашифрованного файла выполняется
`npm run db:import-legacy -- --apply` после создания проверенной копии файла
и ключа. Импорт сохраняет
исходные исследования как архив восстановления: он не создаёт проверенные
версии наборов данных и блокчейн-коммитменты. Перед импортом URL понадобится
`SOURCE_URL_ENCRYPTION_KEY`, соответствующий ключу, которым были зашифрованы
исходные URL.
