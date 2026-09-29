# Деплой QARAU API на Fly.io

Команды запускаются из корня репозитория. `fly.toml` выбирает API-only
`server/Dockerfile`, порт `8080` и приложение `server-hidden-canyon-2603`.
Сейчас это `legacy`-режим: `/api/v1` в нём не доступен. Образ не содержит
собранный React-интерфейс.

## Первый запуск

Приложение уже создано, а том `qarau_private` объёмом 1 ГБ уже подключён в
регионе `arn`. Для нового приложения том нужно создать до деплоя:

```powershell
fly volumes create qarau_private -a <имя-приложения> -r arn --size 1 --yes
```

Зашифрованное состояние и локальный ключ лежат на этом томе. Fly Volumes не
реплицируются автоматически. Для текущего локального хранилища нужна одна
машина; два экземпляра имели бы разные данные и сессии.

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
HTTP 200 и `"mode":"legacy"`. `--ha=false` не создаёт запасной экземпляр
при новом развёртывании; текущий масштаб также установлен в одну машину.
Проверка здоровья Fly использует тот же путь.

Для диагностики запуска:

```powershell
fly logs -a server-hidden-canyon-2603
```

## Отдельный фронтенд

Если фронтенд обращается к API с другого origin, настройте `ALLOWED_ORIGIN`
как секрет Fly. Авторизация использует cookie `SameSite=Strict`, поэтому для
входа через браузер фронтенд и API должны находиться на одном сайте.

## Integrated-режим

Для `/api/v1` требуются MongoDB Atlas, S3-совместимое хранилище и секреты,
проверяемые `server/runtime/config.mjs`. Команда `npm run db:migrate`
идемпотентно создаёт коллекции и индексы MongoDB. Настройка `MONGODB_URI`
сама по себе не переключает приложение: до добавления остальных зависимостей
Fly app работает в `legacy`-режиме.

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
версии наборов данных и блокчейн-коммитменты. При будущем переключении на
`integrated` также понадобится `SOURCE_URL_ENCRYPTION_KEY`, соответствующий
ключу, которым были зашифрованы импортированные URL.
