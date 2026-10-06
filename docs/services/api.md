# Сервис `api`

Единственный JSON-интерфейс для экранов. Читает PostgreSQL. Пишет только `settings` и `telephony_extensions`. В amoCRM не ходит. Файлы записей не хранит: для плеера подписывает временную ссылку на объект в `minio`.

Команда «обновить данные» не синхронизирует amoCRM внутри этого процесса. Сервис публикует сообщение в `crm.commands` и сразу возвращает ответ, что команда принята.

## Вход

### Чтение списков и карточек

```http
GET /api/calls?manager_id={uuid}&date_from=2026-10-01&date_to=2026-10-05&q=Альфа&deal_status_id={amo_status_id}&sort=objections_score&order=asc&page=1&per_page=50
```

| Параметр | Смысл |
| --- | --- |
| `manager_id` | наш id менеджера; пусто — все |
| `date_from`, `date_to` | включительно, календарные даты в часовом поясе настроек, сравнение по `calls.started_at` |
| `q` | подстрока в имени контакта, названии компании или телефоне |
| `deal_status_id` | текущая стадия сделки |
| `sort` | `started_at`, `manager_name`, `opening_score`, `needs_score`, `presentation_score`, `objections_score`, `closing_score`, `overall_score` |
| `order` | `asc` или `desc` |
| `page` | с 1 |
| `per_page` | по умолчанию 50, максимум 100 |

По умолчанию `sort=started_at` и `order=desc`. В выборку списка попадают только строки `processing_status=completed`.

```http
GET /api/calls/{id}
GET /api/calls/{id}/recording
GET /api/managers?date_from=2026-10-01&date_to=2026-10-05&sort=overall_score&order=desc
GET /api/managers/{amo_user_id}?date_from=2026-10-01&date_to=2026-10-05
GET /api/managers/{amo_user_id}/calls?...те же параметры, что у /api/calls, без manager_id
GET /api/filters
GET /api/settings
GET /api/integration
```

`GET /api/calls/{id}/recording` не принимает тело. Сервис проверяет, что у звонка есть `recording_storage_key`, и подписывает ссылку на чтение.

### Запись настроек

```http
PUT /api/settings
Content-Type: application/json
```

```json
{
  "min_call_duration_sec": 180,
  "weights": {
    "opening": 0.15,
    "needs": 0.30,
    "presentation": 0.20,
    "objections": 0.20,
    "closing": 0.15
  }
}
```

Остальные поля `settings` (интервалы опроса, параллельность, версия инструкции) в этом запросе не меняются. Сумма весов должна быть равна 1. Порог — целое число секунд больше нуля.

### Команда синхронизации

```http
POST /api/sync
```

Тела нет. Сервис публикует в `crm.commands`:

```json
{
  "message_id": "uuid",
  "command": "sync_reference",
  "enqueued_at": "2026-10-05T20:15:00+03:00"
}
```

`sync_reference` означает: обновить пользователей, воронки и текущие статусы сделок у уже сохранённых звонков. Первичный импорт истории этой кнопкой не запускается. Его запускает `crm-sync` сам, один раз, сразу после успешного OAuth.

## Выход

### `GET /api/calls`

```json
{
  "page": 1,
  "per_page": 50,
  "total": 2,
  "items": [
    {
      "id": "58374",
      "started_at": "2026-04-28T16:42:00+03:00",
      "duration_sec": 1458,
      "direction": "out",
      "phone": "+79990000000",
      "manager": {
        "id": "b7e1",
        "amo_user_id": 123,
        "name": "Анна Петрова"
      },
      "contact": {
        "name": "Алексей Смирнов",
        "company_name": "ООО Альфа",
        "amo_url": "https://example.amocrm.ru/contacts/detail/456"
      },
      "deal": {
        "amo_lead_id": 789,
        "name": "Поставка",
        "link_status": "linked",
        "status_name": "Переговоры",
        "amo_url": "https://example.amocrm.ru/leads/detail/789"
      },
      "scores": {
        "opening": 85,
        "needs": 90,
        "presentation": 88,
        "objections": 70,
        "closing": 92,
        "overall": 86
      }
    }
  ]
}
```

Если контакт не определён, `contact` равен `null`. Если сделка не привязана, `deal.amo_lead_id` равен `null`, `deal.link_status` равен `unresolved` или `ambiguous`, `deal.status_name` — пустая строка. Для `ambiguous` клиент показывает подпись «Несколько активных сделок». Для `unresolved` — «Сделка не определена».

В списке `status_name` — это **текущий** статус сделки.

### `GET /api/calls/{id}`

Объект элемента списка плюс поля карточки:

```json
{
  "id": "58374",
  "started_at": "2026-04-28T16:42:00+03:00",
  "duration_sec": 1458,
  "direction": "out",
  "phone": "+79990000000",
  "processing_status": "completed",
  "manager": { "id": "b7e1", "amo_user_id": 123, "name": "Анна Петрова" },
  "contact": {
    "name": "Алексей Смирнов",
    "company_name": "ООО Альфа",
    "amo_url": "https://example.amocrm.ru/contacts/detail/456"
  },
  "deal": {
    "amo_lead_id": 789,
    "name": "Поставка",
    "link_status": "linked",
    "status_at_call_name": "Переговоры",
    "status_name": "Счет выставлен",
    "amo_url": "https://example.amocrm.ru/leads/detail/789"
  },
  "scores": {
    "opening": 85,
    "needs": 70,
    "presentation": 68,
    "objections": 55,
    "closing": 60,
    "overall": 67
  },
  "comments": {
    "opening": "Хорошо установил контакт",
    "needs": "Выявил проблему, но не выяснил критерии выбора",
    "presentation": "Презентация слишком общая",
    "objections": "Слабо отработал возражение по стоимости",
    "closing": "Не зафиксирован следующий шаг"
  },
  "summary": "Клиент заинтересован. Основная потребность выявлена.",
  "next_step_detected": false,
  "transcript": [
    {
      "speaker": "manager",
      "start": 0.0,
      "end": 4.5,
      "text": "Добрый день, Алексей..."
    }
  ],
  "has_recording": true
}
```

На главном экране этот метод для незавершённых звонков не нужен. Прямой запрос по id возвращает звонок в любом статусе: тогда `scores`, `comments`, `summary` и `transcript` могут быть `null`, а `processing_status` объясняет, почему оценки ещё нет.

Неизвестный id — ответ `404` с телом `{ "error": "call_not_found" }`.

### `GET /api/calls/{id}/recording`

Ответ `302` на временную ссылку чтения объекта. Срок ссылки — 15 минут. Если файла нет — `404` `{ "error": "recording_missing" }`.

### `GET /api/managers`

Средние считаются по звонкам этого менеджера со статусом `completed` и `started_at` внутри периода. Звонок без `manager_id` в этот список не входит.

```json
{
  "date_from": "2026-10-01",
  "date_to": "2026-10-05",
  "items": [
    {
      "amo_user_id": 123,
      "name": "Анна Петрова",
      "is_active": true,
      "calls_count": 120,
      "scores": {
        "opening": 88,
        "needs": 91,
        "presentation": 86,
        "objections": 72,
        "closing": 78,
        "overall": 83
      }
    }
  ]
}
```

Средние — целые, арифметическое округление. У менеджера без звонков за период `calls_count` равен 0, оценки равны `null`. Такие менеджеры в списке остаются, если `is_active=true`.

`sort` для этого метода: `name`, `calls_count` и те же шесть ключей оценок. Пустые оценки при сортировке по оценке уходят в конец.

### `GET /api/managers/{amo_user_id}`

Один объект из `items` плюс `email`. Неизвестный `amo_user_id` — `404` `{ "error": "manager_not_found" }`.

### `GET /api/managers/{amo_user_id}/calls`

Тот же объект, что `GET /api/calls`, уже отфильтрованный по менеджеру.

### `GET /api/filters`

```json
{
  "managers": [
    { "id": "b7e1", "amo_user_id": 123, "name": "Анна Петрова" }
  ],
  "deal_statuses": [
    { "amo_status_id": 142, "name": "Переговоры", "pipeline_name": "Продажи" }
  ]
}
```

В `managers` только `is_active=true`. Стадии — все неуспешные и успешные статусы подключённого аккаунта, в порядке воронки.

### `GET /api/settings`

Текущие редактируемые поля:

```json
{
  "min_call_duration_sec": 180,
  "weights": {
    "opening": 0.15,
    "needs": 0.30,
    "presentation": 0.20,
    "objections": 0.20,
    "closing": 0.15
  }
}
```

### `PUT /api/settings`

При успехе — то же тело, что у `GET /api/settings`, уже с новыми значениями. При ошибке проверки — `422`:

```json
{
  "error": "invalid_settings",
  "details": ["weights_sum_must_be_1"]
}
```

### `GET /api/integration`

```json
{
  "connected": true,
  "amo_subdomain": "example",
  "last_user_sync_at": "2026-10-05T18:00:00+03:00",
  "last_poll_at": "2026-10-05T20:14:00+03:00",
  "history_imported_at": "2026-10-01T10:00:00+03:00"
}
```

Пока OAuth не пройден, `connected` равен `false`, остальные поля — `null`.

### `POST /api/sync`

```json
{
  "accepted": true,
  "command": "sync_reference"
}
```

Ответ `202`. Появление новых данных на экране зависит от того, когда `crm-sync` закончит команду. Этот метод их не ждёт.

## Ошибки, общие для методов

Неизвестный параметр `sort` или `order` — `400` `{ "error": "invalid_query" }`.
