# Сервис `api`

Единственный HTTP-интерфейс ядра. Принимает звонок по [контракту](../intake.md), хранит проекты и карточку оценки, отдаёт JSON экранам. В CRM не ходит. Токены CRM не хранит.

Файл с формы кладёт в `minio` сам. Файл по URL не скачивает: публикует задание, его выполнит `media`. Для плеера сам отдаёт байты записи. Адрес хранилища наружу не выдаёт.

## Вход

Чтение и настройка приходят с экранов `web` и требуют сессию аккаунта. Приём звонка с формы требует ту же сессию. Приём от плагина и обновление его справочников идут с `Authorization: Bearer {source_token}` и сессию человека не спрашивают.

Сессия — cookie `session` после `POST /api/session`. Без cookie методы экранов отвечают `401` `{ "error": "unauthenticated" }`. Выключенный аккаунт получает тот же ответ.

Роль проверяется до чтения проекта. Чужой проект для руководителя и менеджера по продажам — `404` `{ "error": "project_not_found" }`. Свой проект, но действие не входит в роль — `403` `{ "error": "forbidden" }`.

| Действие | Администратор | Руководитель | Менеджер по продажам |
| --- | --- | --- | --- |
| Создать проект, аккаунт, назначить роль | да | нет | нет |
| Промпты анализа | да | нет | нет |
| Список проектов | все проекты установки | только свои | только свои |
| Звонки, произвольные поля, скрипты, источники | да | да | нет |
| Читать звонки, карточки разговоров, сводку участников | да | да | да |

Тело звонка, менеджеров, контакта и сделки разобрано в контракте приёма. Ниже — методы, которых в том контракте нет, и то, что сервис делает после успешного приёма.

### Сессия

```http
POST /api/session
DELETE /api/session
GET /api/me
```

`POST` принимает `{ "email": "lead@client.example", "password": "..." }`. Успех — `204` и cookie `session`. Неверная пара или выключенный аккаунт — `401`.

`DELETE` гасит cookie и отвечает `204`.

### Аккаунты

Только администратор.

```http
GET /api/accounts
POST /api/accounts
PATCH /api/accounts/{account_id}
PUT /api/accounts/{account_id}/projects
```

`POST`:

```json
{
  "email": "lead@client.example",
  "name": "Сергей Иванов",
  "password": "временный пароль",
  "is_administrator": false
}
```

`PATCH` принимает те же поля по отдельности, плюс `is_active`. Пароль в ответах не возвращается. Повтор почты — `409` `{ "error": "email_taken" }`. Попытка выключить последнего активного администратора — `409` `{ "error": "last_administrator" }`.

`PUT .../projects` заменяет список доступов целиком:

```json
{
  "items": [
    { "project_id": "p1", "role": "lead" }
  ]
}
```

`role` — `lead` или `sales_manager`. Аккаунт-администратор в этот список не нуждается: проекты ему видны и без членства.

### Проекты

```http
GET /api/projects
POST /api/projects
```

`POST` принимает `{ "name": "Отдел продаж" }` и доступен только администратору. Остальным — `403`.

### Настройки анализа

Только администратор. Руководитель и менеджер по продажам получают `403`.

```http
GET /api/projects/{project_id}/settings
PUT /api/projects/{project_id}/settings
```

Тело `PUT`:

```json
{
  "timezone": "Europe/Moscow",
  "min_call_duration_sec": 180,
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

Язык в этом запросе не передаётся и в проекте не хранится: распознавание и промпты русские на всю установку.

В `stages` ровно пять ключей: `opening`, `needs`, `presentation`, `objections`, `closing`. Другой набор — `422` `{ "error": "stage_set_is_fixed" }`. Меняются `title`, `weight` и `instruction`. Сумма `weight` равна 1. `min_call_duration_sec` — целое больше нуля. Успешное сохранение увеличивает `scorecards.version`. Готовые `call_analysis` сервис не переписывает.

### Порог для плагина

Плагин читает порог до отправки звонка. Сессию человека этот вызов не спрашивает.

```http
GET /api/projects/{project_id}/min-call-duration
Authorization: Bearer {source_token}
```

Ответ `200`:

```json
{ "min_call_duration_sec": 180 }
```

В ответе только это поле. Пояс, этапы и остальные настройки не отдаются. Запись настроек этим токеном недоступна: `PUT .../settings` по-прежнему только у администратора. Токен другого проекта — `403` `{ "error": "source_project_mismatch" }`.

Плагин сравнивает известную длительность с этим числом и не шлёт заведомо короткие звонки. Если такой звонок всё же пришёл и `duration_sec` уже известен и ниже порога, ответ прежний: `422` `{ "error": "duration_below_minimum" }`, строки нет.

### Источники

`GET` и `POST` — администратор или руководитель. Обмен кода вызывает плагин, без сессии человека.

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

### Скрипты проекта

Администратор или руководитель. Скрипт участвует в оценке. Произвольные поля звонка сюда не входят.

```http
GET /api/projects/{project_id}/inputs
POST /api/projects/{project_id}/inputs
PATCH /api/projects/{project_id}/inputs/{input_id}
DELETE /api/projects/{project_id}/inputs/{input_id}
```

`POST` и `PATCH` принимают:

```json
{
  "title": "Исходящий первый звонок",
  "body": "Представиться, назвать компанию, спросить, удобно ли говорить."
}
```

Поле `kind` больше не принимается: в этой коллекции только скрипты. Пустые `title` или `body` — `422` `{ "error": "invalid_input" }`. Значение `kind`, если оно всё же пришло и не равно `script`, — тот же отказ.

`GET` отвечает `{ "items": [ ... ] }`. `POST` — `201` и один объект с `id` и `updated_at`. `DELETE` — `204`.

Загрузка звонка и правка имени ручного участника разговора доступны администратору и руководителю. Смена скрипта не пересчитывает уже готовые звонки. В новый анализ попадает снимок всех скриптов проекта в `inputs_json`. Выбора скрипта на один звонок нет. Поля записи в этот снимок не пишутся.

### Ручной менеджер

```http
PATCH /api/projects/{project_id}/managers/{manager_id}
```

```json
{ "name": "Анна Петрова" }
```

### Чтение экранов

```http
GET /api/projects/{project_id}/calls?manager_id={uuid}&date_from=2026-10-01&date_to=2026-10-13&q=Альфа&deal_status=Переговоры&field_key=segment&field_value=enterprise&sort=stage.objections&order=asc&page=1&per_page=50
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
| `q` | подстрока в имени контакта, компании, телефоне, имени менеджера или названии сделки |
| `deal_status` | точное `current_deal_status_name`. Это стадия сделки, не этап карточки. Пустой пункт на экране — «Все стадии» |
| `field_key`, `field_value` | оба сразу: точное совпадение с одним произвольным полем звонка. Одно без другого — `400` |
| `sort` | `started_at`, `manager`, `overall` или `stage.{key}` текущего проекта |
| `order` | `asc` или `desc` |
| `page` | с 1 |
| `per_page` | по умолчанию 50, максимум 100 |

По умолчанию `sort=started_at` и `order=desc`. В списке только `processing_status=completed`.

`GET .../calls/{id}/recording` читает объект из хранилища и отдаёт его байты, если у звонка есть `recording_storage_key`.

## Выход

### `GET /api/me`

```json
{
  "id": "acc-1",
  "email": "lead@client.example",
  "name": "Сергей Иванов",
  "is_administrator": false,
  "projects": [
    { "id": "p1", "name": "Отдел продаж", "role": "lead" }
  ]
}
```

У администратора `is_administrator` равен `true`, а `projects` — пустой массив: список проектов он получает через `GET /api/projects`.

### Аккаунты

`GET /api/accounts` и успешные `POST` / `PATCH`:

```json
{
  "items": [
    {
      "id": "acc-1",
      "email": "lead@client.example",
      "name": "Сергей Иванов",
      "is_administrator": false,
      "is_active": true,
      "projects": [
        { "id": "p1", "name": "Отдел продаж", "role": "lead" }
      ]
    }
  ]
}
```

`POST` отвечает `201` одним объектом, не обёрткой `items`. `PUT .../projects` отвечает `200` тем же объектом аккаунта уже с новым списком.

### После создания проекта

`201`:

```json
{
  "id": "p1",
  "name": "Отдел продаж",
  "timezone": "Europe/Moscow",
  "min_call_duration_sec": 180
}
```

Вместе с проектом появляются ручной источник и шаблон из пяти этапов.

`GET /api/projects` возвращает `{ "items": [ ...те же поля, без порога ] }`.

### Настройки

`GET` и успешный `PUT` возвращают сохранённое тело: пояс, порог и этапы.

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

Если записи нет, статус `recording_pending`, в очередь ничего не ставится. Ядро само этот статус не опрашивает и в CRM не ходит. Поздний файл принимается, пока статус остаётся `recording_pending`.

`last_intake_at` источника обновляется на успешном приёме звонка и на успешном `PUT` менеджеров.

Повтор того же `external_id` новую очередь не ставит, кроме двух случаев. При `recording_pending` первая запись ставит звонок в очередь. При `recording_missing` рабочая запись возвращает звонок в `audio_queued`. Статусы `completed`, `skipped_short`, `skipped_no_duration` и `failed` этим не открываются заново.

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
        { "key": "presentation", "score": 90 },
        { "key": "objections", "score": 70 },
        { "key": "closing", "score": 95 }
      ],
      "overall_score": 86
    }
  ]
}
```

`contact` равен `null`, если контакта нет. `company_name` при этом всё равно может быть заполнена: она хранится на самом звонке.

`status_name` в списке — текущая стадия. `stages` — оценки пяти фиксированных ключей из снимка этого звонка.

Для `ambiguous` и `unresolved` в `deal` нет `external_url`, `name` пустое, заполнен `link_status`. Для `absent` объект `deal` равен `null`.

### `GET .../calls/{id}`

Поля списка плюс статус, снимок комментариев и транскрипт. Метод отдаёт звонок в любом статусе, и карточка показывает этот `processing_status`. У незавершённого `stages`, `summary` и `transcript` равны `null`. При `failed` в ответе есть `error`.

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
      "weight": 0.15,
      "instruction": "Начало разговора и установление контакта",
      "score": 85,
      "comment": "Хорошо установил контакт"
    }
  ],
  "overall_score": 67,
  "summary": "Клиент заинтересован. Основная потребность выявлена.",
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

У каждого этапа снимка здесь есть `key`, `title`, `weight`, `instruction`, `score` и `comment`. `instruction` — формулировка, которая ушла в модель для этого звонка. Экран показывает её. Поздняя правка промпта этот снимок не меняет. Неизвестный id или чужой проект — `404` `{ "error": "call_not_found" }`.

### Запись для плеера

`GET .../calls/{id}/recording` отвечает `200` и телом файла. `Content-Type` берётся из `recording_content_type`. Файла нет — `404` `{ "error": "recording_missing" }`. Браузер использует этот адрес как источник плеера. Ссылки на `minio` в ответе нет.

### Проблемы обработки

```http
GET /api/projects/{project_id}/calls?view=problems
```

Администратор и руководитель. Менеджер по продажам получает `403`. В выборке статусы `failed`, `recording_missing`, `skipped_short`, `skipped_no_duration`. У элемента есть `processing_status` и `error`. `error.message` — код в `snake_case`, не фраза. Оценок нет. Пагинация та же, что у обычного списка. `skipped_short` и `skipped_no_duration` остаются здесь, а не в списке звонков в работе.

### Звонки в работе

```http
GET /api/projects/{project_id}/calls?view=progress
```

Администратор и руководитель. Менеджер по продажам получает `403`. В выборке статусы `recording_pending`, `audio_queued`, `audio_fetch`, `transcribing`, `analyzing`. Оценок нет. Пагинация та же, что у обычного списка.

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

В `stages` ровно этапы текущей карточки, по порядку. `score` этапа — среднее по звонкам периода со статусом `completed`. `calls_count` — число этих же завершённых звонков. `overall_score` — среднее сохранённых итогов. Округление до целого. Нет ни одного итога — `overall_score` равен `null`, оценки этапов тоже `null`.

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
