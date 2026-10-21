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

Первый срез поднимается одним compose на одном сервере. Снаружи открыт только `ingress` (HTTPS). `api` принимает вход по cookie, проекты и ручную загрузку звонка. `web`, `media`, `transcriber` и `analyzer` отвечают на проверку живости и не выполняют конвейер.

```bash
docker compose up --build
```

Локальный администратор после старта: `admin@example.com` / `admin-password`. Когда стек здоров, сценарий среза запускается так: `node apps/api/test/e2e.mjs`.

```bash
curl -k -c /tmp/calls.cj -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"admin-password"}' \
  https://localhost/api/session
```
