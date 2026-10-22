# Call Analytics

Сервис оценки звонков. Репозиторий: `seller-reviewer`. Проект хранит записи, транскрипты и оценки. Данные о менеджере, клиенте и сделке попадают в проект вручную или из плагина CRM. amoCRM — первый такой плагин, не обязательная часть системы.

Документы:

- [Обзор продукта](docs/product.md)
- [Архитектура](docs/architecture.md)
- [Контракт приёма звонка](docs/intake.md)
- [Модель данных ядра](docs/data-model.md)
- [Сервисы ядра](docs/services/README.md)
- [Плагины CRM](docs/plugins/README.md)
- [Принятые решения](docs/assumptions.md)
- [Открытые вопросы](docs/open-questions.md)

Контракты ядра зафиксированы в [docs/](docs/README.md). Плагин amoCRM в этот репозиторий не входит, пока не пройден чеклист одного живого звонка.

Стек поднимается одним compose на одном сервере. Снаружи открыт только `ingress` (HTTPS). `api` принимает вход по cookie, проекты и ручную загрузку звонка. `media` кладёт запись в хранилище и проверяет длительность, `transcriber` пишет реплики, `analyzer` ставит оценки. `web` — статический интерфейс: вход, проекты, звонки, карточка разговора, менеджеры, проблемы обработки и звонки в работе.

Речь и оценка вызываются по адресу из окружения (`STT_API_URL` или URL в `STT_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL`). Без этих переменных задание заканчивается `failed`, отдельные ключи для сборки не нужны. Потолки одновременных заданий: `TRANSCRIBE_CONCURRENCY` и `ANALYZE_CONCURRENCY`.

```bash
docker compose up --build
```

Локальный администратор после старта: `admin@example.com` / `admin-password`. Когда стек здоров, сценарий среза запускается так: `node apps/api/test/e2e.mjs`.

```bash
curl -k -c /tmp/calls.cj -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"admin-password"}' \
  https://localhost/api/session
```

## Запуск на хосте

Для правок без пересборки образов Postgres, Redis и MinIO остаются в Docker, а `api`, `media`, `transcriber`, `analyzer` и статический `web` запускаются на машине. Команда `docker compose up --build` выше по-прежнему поднимает весь стек в контейнерах.

Нужны Node.js 22 или новее и Docker. Скопируйте `.env.example` в `.env`. В адресах базы, Redis и MinIO оставляйте `127.0.0.1`: на Windows `localhost` часто уходит в `::1`, и соединение встаёт.

```powershell
copy .env.example .env
npm install
npm run db:up
scripts\local\build-apps.cmd
scripts\local\start-apps.cmd
npm run dev:web
```

Интерфейс: http://127.0.0.1:3100 . Вход тот же: `admin@example.com` / `admin-password`. Страницу открывайте именно по `127.0.0.1`: cookie сессии стоит с флагом `Secure`, браузер принимает её на этом адресе.

`npm run db:up` поднимает только Postgres, Redis и MinIO. Их порты опубликованы на `127.0.0.1` (`5432`, `6379`, `9000`). Контейнеры по-прежнему ходят друг к другу по именам `postgres`, `redis` и `minio`. Если эти порты уже заняты, поменяйте `DATABASE_PORT`, `REDIS_PORT` или `MINIO_PORT` и тот же порт в `DATABASE_URL`, `REDIS_URL` или `S3_ENDPOINT`. После полного compose сначала выполните `npm run db:down` (тома с данными сохраняются), иначе контейнеры приложений и процессы на хосте будут читать одни очереди.

В `.env` должны быть заданы:

- `DATABASE_URL` — `postgresql://calls:calls@127.0.0.1:5432/calls`
- `REDIS_URL` — `redis://127.0.0.1:6379`
- `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` — MinIO на `127.0.0.1:9000`, бакет `recordings`
- `SESSION_SECRET` — не короче 16 символов
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` — первый администратор, если в базе его ещё нет
- `API_PORT`, `MEDIA_PORT`, `TRANSCRIBER_PORT`, `ANALYZER_PORT`, `WEB_PORT` — порты процессов на хосте

Без `STT_API_URL` или `STT_PROVIDER` и `STT_API_KEY` распознавание заканчивается `failed`. Без `LLM_BASE_URL`, `LLM_API_KEY` и `LLM_MODEL` так же заканчивается оценка. Сборка из-за пустых значений не останавливается.

Один сервис с перезапуском при правках: `npm run dev:api`, `npm run dev:media`, `npm run dev:transcriber`, `npm run dev:analyzer`. Перед этим нужна та же сборка: пакеты читаются из `dist`. Остановить инфраструктуру: `npm run db:down`. Занятые порты процессов: `powershell -File scripts\local\kill-ports.ps1`.
