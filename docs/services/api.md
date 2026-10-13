# Сервис `api`

Единственный HTTP-интерфейс ядра. Принимает звонок по [контракту](../intake.md), хранит проекты и карточку оценки, отдаёт JSON экранам. В CRM не ходит. Токены CRM не хранит.

Файл с формы кладёт в `minio` сам. Файл по URL не скачивает: публикует задание, его выполнит `media`. Для плеера подписывает временную ссылку на уже лежащий объект.

## Вход

Чтение и настройка приходят с экранов `web`. Приём звонка и обновление справочников приходят либо с этих экранов, либо от плагина с `Authorization: Bearer {source_token}`.

Тело звонка, менеджеров, контакта и сделки разобрано в контракте приёма. Ниже — методы, которых в том контракте нет, и то, что сервис делает после успешного приёма.

### Проекты

```http
GET /api/projects
POST /api/projects
```

`POST` принимает `{ "name": "Отдел продаж" }`.

### Настройки анализа

```http
GET /api/projects/{project_id}/settings
PUT /api/projects/{project_id}/settings
```

Тело `PUT`:

```json
{
  "timezone": "Europe/Moscow",
  "language": "ru",
  "min_call_duration_sec": 180,
  "ask_next_step": true,
  "stages": [
    {
      "key": "opening",
      "title": "Открытие",
      "weight": 0.15,
      "instruction": "Начало разговора и установление контакта"
    }
  ]
}
```

В `stages` не меньше одного элемента. `key` уникален, совпадает с шаблоном `[a-z0-9_]+` и после создания этапа не меняется через этот запрос: новый `key` добавляет этап, пропавший из списка — убирает его из будущих оценок. Сумма `weight` равна 1. `min_call_duration_sec` — целое больше нуля. Успешное сохранение увеличивает `scorecards.version`. Готовые `call_analysis` сервис не переписывает.

### Источники

```http
GET /api/projects/{project_id}/sources
POST /api/projects/{project_id}/sources
POST /api/source-setup/exchange
```

`POST` источника:

```json
{
  "provider": "amocrm",
  "display_name": "amoCRM"
}
```

`provider` выбирает, какой плагин откроет браузер. Ядро само плагин не вызывает.

Обмен кода вызывает уже плагин:

```json
{ "setup_code": "одноразовый код" }
```

### Ручной менеджер

```http
PATCH /api/projects/{project_id}/managers/{manager_id}
```

```json
{ "name": "Анна Петрова" }
```

### Чтение экранов

```http
GET /api/projects/{project_id}/calls?manager_id={uuid}&date_from=2026-10-01&date_to=2026-10-13&q=Альфа&deal_status=Переговоры&sort=stage.objections&order=asc&page=1&per_page=50
GET /api/projects/{project_id}/calls/{id}
GET /api/projects/{project_id}/calls/{id}/recording
GET /api/projects/{project_id}/managers?date_from=2026-10-01&date_to=2026-10-13&sort=overall&order=desc
GET /api/projects/{project_id}/managers/{manager_id}?date_from=2026-10-01&date_to=2026-10-13
GET /api/projects/{project_id}/managers/{manager_id}/calls
GET /api/projects/{project_id}/filters
```

Параметры списка звонков:

| Параметр | Смысл |
| --- | --- |
| `manager_id` | id менеджера в ядре; пусто — все |
| `date_from`, `date_to` | календарные даты включительно в поясе проекта, сравнение по `started_at` |
| `q` | подстрока в имени контакта, компании или телефоне |
| `deal_status` | точное `current_deal_status_name` |
| `sort` | `started_at`, `manager`, `overall` или `stage.{key}` текущего проекта |
| `order` | `asc` или `desc` |
| `page` | с 1 |
| `per_page` | по умолчанию 50, максимум 100 |

По умолчанию `sort=started_at` и `order=desc`. В списке только `processing_status=completed`.

`GET .../calls/{id}/recording` подписывает ссылку, если у звонка есть `recording_storage_key`.

## Выход

### После создания проекта

`201`:

```json
{
  "id": "p1",
  "name": "Отдел продаж",
  "timezone": "Europe/Moscow",
  "language": "ru",
  "min_call_duration_sec": 180,
  "scorecard_version": 1
}
```

Вместе с проектом появляются ручной источник и шаблон из пяти этапов.

`GET /api/projects` возвращает `{ "items": [ ...те же поля, без порога и версии ] }`.

### Настройки

`GET` и успешный `PUT` возвращают сохранённое тело плюс `"scorecard_version": 4`.

Ошибка проверки — `422`:

```json
{
  "error": "invalid_settings",
  "details": ["weights_sum_must_be_1"]
}
```

### Источник и код связки

`GET .../sources`:

```json
{
  "items": [
    {
      "id": "src-manual",
      "kind": "manual",
      "provider": null,
      "display_name": "Ручная загрузка",
      "last_intake_at": null
    },
    {
      "id": "src-amo",
      "kind": "plugin",
      "provider": "amocrm",
      "display_name": "amoCRM",
      "last_intake_at": "2026-10-13T12:00:00+03:00"
    }
  ]
}
```

`POST .../sources` отвечает `201`:

```json
{
  "source_id": "src-amo",
  "setup_code": "одноразовый код",
  "expires_at": "2026-10-13T12:15:00+03:00"
}
```

Код живёт 15 минут и принимается один раз.

`POST /api/source-setup/exchange` отвечает `200`:

```json
{
  "project_id": "p1",
  "source_id": "src-amo",
  "source_token": "секрет, который плагин сохраняет у себя"
}
```

Повторный обмен того же кода — `401` `{ "error": "setup_code_used" }`. Просроченный код — `401` `{ "error": "setup_code_expired" }`.

### После принятого звонка

Ответ `POST` звонка и прикладывания записи описан в контракте приёма. Дополнительно сервис делает следующее.

Пишет или находит менеджера, контакт и строку `calls`. Для плагина менеджер и контакт ищутся по `(project_id, source_id, external_id)`. Имя и ссылка из тела обновляют уже существующую строку справочника. Для формы менеджер берётся по `manager.id` либо создаётся ручным с переданным именем.

Если в теле есть `recording.url`, в строку пишется `recording_source_url`, статус становится `audio_queued`, в Redis уходит:

```json
{
  "message_id": "uuid",
  "project_id": "p1",
  "call_id": "58374",
  "attempt": 1,
  "enqueued_at": "2026-10-13T12:00:00+03:00",
  "audio": {
    "type": "url",
    "url": "https://records.example/abc.mp3"
  }
}
```

Если пришёл файл, сервис сохраняет его как `projects/{project_id}/calls/{call_id}.{ext}` и публикует то же задание с `audio.type=object`, `bucket`, `key` и `content_type`.

Если записи нет, статус `recording_pending`, в очередь ничего не ставится.

`last_intake_at` источника обновляется на успешном приёме звонка и на успешном `PUT` менеджеров.

Повтор того же `external_id` новую очередь не ставит, кроме случая `recording_pending`, когда запись пришла впервые.

### `GET .../calls`

```json
{
  "page": 1,
  "per_page": 50,
  "total": 1,
  "items": [
    {
      "id": "58374",
      "started_at": "2026-04-28T16:42:00+03:00",
      "duration_sec": 1458,
      "direction": "out",
      "phone": "+79990000000",
      "source": { "kind": "plugin", "provider": "amocrm", "display_name": "amoCRM" },
      "manager": { "id": "b7e1", "name": "Анна Петрова" },
      "company_name": "ООО Альфа",
      "contact": {
        "name": "Алексей Смирнов",
        "external_url": "https://example.amocrm.ru/contacts/detail/456"
      },
      "deal": {
        "name": "Поставка",
        "link_status": "linked",
        "status_name": "Переговоры",
        "external_url": "https://example.amocrm.ru/leads/detail/789"
      },
      "stages": [
        { "key": "opening", "score": 85 },
        { "key": "needs", "score": 90 },
        { "key": "objections", "score": 70 }
      ],
      "overall_score": 86
    }
  ]
}
```

`contact` равен `null`, если контакта нет. `company_name` при этом всё равно может быть заполнена: она хранится на самом звонке.

`status_name` в списке — текущая стадия. `stages` содержит только ключи, которые есть в снимке этого звонка. Колонка текущей карточки без такого ключа на экране пустая.

Для `ambiguous` и `unresolved` в `deal` нет `external_url`, `name` пустое, заполнен `link_status`. Для `absent` объект `deal` равен `null`.

### `GET .../calls/{id}`

Поля списка плюс статус, снимок комментариев и транскрипт. Метод отдаёт звонок в любом статусе. У незавершённого `stages`, `summary` и `transcript` равны `null`.

```json
{
  "id": "58374",
  "processing_status": "completed",
  "started_at": "2026-04-28T16:42:00+03:00",
  "duration_sec": 1458,
  "direction": "out",
  "phone": "+79990000000",
  "source": { "kind": "manual", "provider": null, "display_name": "Ручная загрузка" },
  "manager": { "id": "b7e1", "name": "Анна Петрова" },
  "company_name": "ООО Альфа",
  "contact": {
    "name": "Алексей Смирнов",
    "external_url": null
  },
  "deal": {
    "name": "Поставка",
    "link_status": "linked",
    "status_at_call_name": "Переговоры",
    "status_name": "Счет выставлен",
    "external_url": null
  },
  "context": {
    "notes": "Клиент сравнивает два предложения.",
    "fields": [
      { "key": "segment", "label": "Сегмент", "value": "enterprise" }
    ]
  },
  "stages": [
    {
      "key": "opening",
      "title": "Открытие",
      "score": 85,
      "comment": "Хорошо установил контакт"
    }
  ],
  "overall_score": 67,
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
  "has_recording": true,
  "scorecard_version": 3
}
```

Названия этапов здесь из снимка анализа, а не из текущих настроек. Неизвестный id или чужой проект — `404` `{ "error": "call_not_found" }`.

### Запись для плеера

`GET .../calls/{id}/recording` отвечает `302` на ссылку чтения объекта. Срок ссылки — 15 минут. Файла нет — `404` `{ "error": "recording_missing" }`.

### Менеджеры

```json
{
  "date_from": "2026-10-01",
  "date_to": "2026-10-13",
  "items": [
    {
      "id": "b7e1",
      "name": "Анна Петрова",
      "is_active": true,
      "source": { "kind": "plugin", "provider": "amocrm" },
      "calls_count": 120,
      "stages": [
        { "key": "opening", "title": "Открытие", "score": 88 },
        { "key": "objections", "title": "Возражения", "score": 72 }
      ],
      "overall_score": 83
    }
  ]
}
```

В `stages` ровно этапы текущей карточки, по порядку. `score` этапа — среднее по звонкам периода со статусом `completed`, у которых в снимке есть этот ключ. Звонок без ключа в это среднее не входит и в `calls_count` входит. `overall_score` — среднее сохранённых итогов. Округление до целого. Нет ни одного итога — `overall_score` равен `null`, оценки этапов тоже `null`.

Активные менеджеры без звонков за период остаются в списке. Неактивные попадают в список, только если за период у них есть завершённый звонок.

`sort`: `name`, `calls_count`, `overall`, `stage.{key}`. Пустая оценка при сортировке по этапу уходит в конец.

`GET .../managers/{manager_id}` — один такой объект плюс `email`. Нет менеджера — `404` `{ "error": "manager_not_found" }`.

`GET .../managers/{manager_id}/calls` — тот же список, что у звонков, уже ограниченный этим менеджером.

`PATCH` имени отвечает обновлённым объектом. Менеджер плагина — `409` `{ "error": "manager_owned_by_plugin" }`.

### Фильтры

```json
{
  "managers": [
    { "id": "b7e1", "name": "Анна Петрова" }
  ],
  "deal_statuses": ["Переговоры", "Счет выставлен"],
  "stages": [
    { "key": "opening", "title": "Открытие" },
    { "key": "needs", "title": "Потребность" }
  ]
}
```

В `managers` только `is_active=true`. `deal_statuses` — различные непустые текущие стадии звонков проекта. `stages` — текущая карточка, по ней `web` строит колонки.

### Общие отказы чтения

Неизвестный `sort`, `order` или ключ этапа — `400` `{ "error": "invalid_query" }`. Чужой или неизвестный `project_id` — `404` `{ "error": "project_not_found" }`. Токен плагина от другого проекта — `403` `{ "error": "source_project_mismatch" }`.
