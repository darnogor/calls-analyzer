# Контракт приёма звонка

Единственная граница между ядром и любым источником. Ручная форма и каждый плагин CRM передают один и тот же JSON. Ядро не принимает сырой webhook CRM и не хранит токены. Идентификатор звонка в чужой системе приходит обычной строкой `external_id`.

Схема тела ниже — источник правды. [api](services/api.md) описывает методы, которые это тело принимают. [Плагин](plugins/README.md) обязан собрать это тело до вызова.

## Кто вызывает

| Источник | Доступ | `external_id` |
| --- | --- | --- |
| Форма в `web` | сессия администратора или руководителя этого проекта | можно не передавать; повторная отправка без ключа создаёт новый звонок |
| Плагин | `Authorization: Bearer {source_token}` | обязателен; повтор с тем же id не создаёт второй звонок |

`source_token` выпускается один раз при подключении источника. Он даёт право писать только в один проект.

## Создание звонка

```http
POST /api/projects/{project_id}/calls
Content-Type: application/json
```

```json
{
  "external_id": "call-uniq-1",
  "direction": "out",
  "phone": "+79990000000",
  "started_at": "2026-04-28T16:42:00+03:00",
  "duration_sec": 1458,
  "recording": {
    "type": "url",
    "url": "https://records.example/abc.mp3"
  },
  "manager": {
    "external_id": "user-123",
    "name": "Анна Петрова",
    "email": "anna@example.com"
  },
  "contact": {
    "external_id": "contact-456",
    "name": "Алексей Смирнов",
    "external_url": "https://crm.example/contacts/456"
  },
  "company_name": "ООО Альфа",
  "deal": {
    "external_id": "deal-789",
    "name": "Поставка",
    "status_at_call_name": "Переговоры",
    "current_status_name": "Переговоры",
    "external_url": "https://crm.example/deals/789",
    "link_status": "linked"
  },
  "context": {
    "notes": "Клиент сравнивает два предложения.",
    "fields": [
      { "key": "segment", "label": "Сегмент", "value": "enterprise" }
    ]
  }
}
```

Ручная загрузка файла использует тот же метод с `multipart/form-data`: часть `payload` содержит этот JSON без `recording`, часть `file` содержит аудио. Поле `Idempotency-Key` в заголовке необязательно. Если оно передано, повтор с тем же ключом в том же проекте возвращает уже созданный звонок.

### Поля

| Поле | Обязательность | Смысл |
| --- | --- | --- |
| `external_id` | для плагина да, для формы нет | Идентификатор звонка у источника. Для amoCRM плагин кладёт сюда `params.uniq`, а если его нет — id примечания |
| `direction` | нет | `in` или `out` |
| `phone` | нет | Номер, как его знает источник |
| `started_at` | да | Время начала с часовым поясом |
| `duration_sec` | нет | Секунды, если источник их уже знает |
| `recording` | нет | Как забрать файл. Пустое значение оставляет звонок в `recording_pending` |
| `recording.type` | если блок есть | `url` |
| `recording.url` | для `url` | Адрес, который ядро может скачать без секретов CRM и телефонии |
| `manager` | нет | Участник со стороны компании |
| `manager.id` | для формы | Уже существующий менеджер проекта. Форма шлёт либо `id`, либо `name` |
| `manager.external_id` | для плагина, если блок `manager` есть | Id человека в системе источника |
| `manager.name` | да, если нет `manager.id` | Отображаемое имя |
| `manager.email` | нет | Почта |
| `contact` | нет | Человек на стороне клиента |
| `contact.external_id` | для плагина, если блок `contact` есть | Id контакта в системе источника |
| `contact.name` | да, если блок есть | Имя |
| `contact.external_url` | нет | Готовая ссылка. Ядро её не собирает |
| `company_name` | нет | Компания на момент звонка. Может прийти без контакта. Позже не переписывается |
| `deal` | нет | Сделка. Пустой блок сохраняется как `link_status=absent` |
| `deal.external_id` | если `link_status=linked` | Id сделки у источника |
| `deal.name` | нет | Название |
| `deal.status_at_call_name` | нет | Стадия в момент звонка, уже человеческим текстом |
| `deal.current_status_name` | нет | Текущая стадия. При создании обычно равна стадии на момент звонка |
| `deal.external_url` | нет | Готовая ссылка на сделку |
| `deal.link_status` | нет | `linked`, `unresolved`, `ambiguous`. Без блока сделки ядро ставит `absent` |
| `context.notes` | нет | Заметка для карточки звонка. В оценку не идёт |
| `context.fields` | нет | Произвольные поля для карточки и фильтра. В оценку не идут |

Ядро не сопоставляет менеджеров и контакты плагина по имени. Совпадение только по `external_id` внутри пары проект + источник. Форма находит менеджера по `manager.id`. Новое имя в форме создаёт нового ручного менеджера.

### Запись, которую ядро не может скачать само

Если файл лежит за сессией CRM или телефонии, источник скачивает его сам и шлёт `multipart` с полем `file`. В JSON тогда нет `recording.url`. Секреты телефонии в ядро не передаются.

### Ответ

`201`, если строка создана. `200`, если это повтор того же `external_id` или `Idempotency-Key`.

```json
{
  "id": "58374",
  "created": true,
  "processing_status": "audio_queued"
}
```

`processing_status` в этом ответе:

| Значение | Когда |
| --- | --- |
| `audio_queued` | Есть URL или файл. Если длительность была передана, она уже не ниже порога. Если длительность пустая, её прочитает `media`: сначала из метаданных, затем из файла |
| `recording_pending` | Карточка принята, файла ещё нет |

Статусы `skipped_short` и `skipped_no_duration` в этом ответе не приходят. `skipped_short` появляется после того, как `media` прочитает длительность и она окажется ниже порога. `skipped_no_duration` появляется, если длительность из метаданных и из файла прочитать нельзя. Провайдер речи в обоих случаях не вызывается. Созданный `id` при этом уже есть, карточка звонка его показывает.

### Отказ

`422`, строка не создаётся:

| `error` | Когда |
| --- | --- |
| `duration_below_minimum` | `duration_sec` передан и он меньше порога проекта |
| `external_id_required` | Вызов с токеном плагина без `external_id` |
| `manager_external_id_required` | Плагин прислал менеджера без `external_id` |
| `contact_external_id_required` | Плагин прислал контакт без `external_id` |
| `invalid_payload` | Нарушена форма полей |

```json
{
  "error": "duration_below_minimum",
  "min_call_duration_sec": 180,
  "duration_sec": 40
}
```

Повторный `POST` с тем же `external_id`, когда звонок уже есть:

- карточка и оценки не затираются;
- если статус `recording_pending` и в новом теле появился `recording.url` или файл, ядро принимает запись и ставит звонок в очередь скачивания;
- иначе ответ `200` с `"created": false` и текущим статусом.

## Запись к уже созданному звонку

Плагин создаёт карточку сразу, а файл прикладывает, когда ссылка появилась.

```http
POST /api/projects/{project_id}/calls/by-external-id/{external_id}/recording
Content-Type: application/json
```

```json
{
  "type": "url",
  "url": "https://records.example/abc.mp3"
}
```

Тот же путь принимает `multipart` с полем `file`, если источник скачал аудио сам.

Ответ `202`:

```json
{
  "id": "58374",
  "processing_status": "audio_queued"
}
```

Повторная прикладка, когда файл уже лежит в хранилище, возвращает `200` и не ставит второе задание.

Если источник исчерпал попытки и записи не будет:

```http
POST /api/projects/{project_id}/calls/by-external-id/{external_id}/recording/missing
```

Тела нет. Статус становится `recording_missing`, только если сейчас он `recording_pending`. Иначе `409`:

```json
{ "error": "recording_already_attached" }
```

Неизвестный `external_id` на этих путях — `404` `{ "error": "call_not_found" }`.

## Обновление людей и сделки без нового анализа

Эти вызовы не запускают распознавание и оценку.

```http
PUT /api/projects/{project_id}/managers
Content-Type: application/json
```

```json
{
  "items": [
    {
      "external_id": "user-123",
      "name": "Анна Петрова",
      "email": "anna@example.com",
      "is_active": true
    }
  ]
}
```

Ядро создаёт или обновляет менеджеров этого источника по `external_id` и записывает `is_active` из элемента. Менеджер этого источника, которого нет в `items`, становится `is_active=false`. Ручные менеджеры этого вызова не касаются. Ответ `200` с числом принятых строк: `{ "upserted": 1 }`.

```http
PATCH /api/projects/{project_id}/contacts/by-external-id/{external_id}
Content-Type: application/json
```

```json
{
  "name": "Алексей Смирнов",
  "company_name": "ООО Альфа",
  "external_url": "https://crm.example/contacts/456"
}
```

Обновляет имя, текущую компанию и ссылку контакта. `company_name` уже созданных звонков не меняет. Неизвестный id — `404`.

```http
PATCH /api/projects/{project_id}/deals/by-external-id/{external_id}
Content-Type: application/json
```

```json
{
  "name": "Поставка",
  "current_status_name": "Счет выставлен",
  "external_url": "https://crm.example/deals/789"
}
```

Обновляет текущие поля сделки на всех звонках этого источника с этим `external_id`. `status_at_call_name` не меняется. Если таких звонков нет — `404`.

## Что в этот контракт не входит

Сырой payload CRM, OAuth, словарь добавочных номеров, справочник воронок и решение «какая из трёх сделок активна». Это работа плагина до вызова. Пример для amoCRM — в [plugins/amocrm.md](plugins/amocrm.md).
