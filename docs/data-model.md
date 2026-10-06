# Модель данных

Одна база PostgreSQL. Имена ниже — логические. Физические типы и миграции появятся вместе с кодом.

Идентификаторы наших строк — UUID. Идентификаторы amoCRM хранятся как числа в полях с префиксом `amo_`.

## `accounts`

Подключение к amoCRM. В текущем допущении строка одна.

| Поле | Смысл |
| --- | --- |
| `id` | наш id |
| `amo_account_id` | id аккаунта amoCRM |
| `amo_subdomain` | поддомен для ссылок |
| `access_token` | текущий токен |
| `refresh_token` | токен обновления |
| `token_expires_at` | момент истечения access token |
| `connected_at` | когда прошёл OAuth |
| `last_user_sync_at` | последняя синхронизация пользователей |
| `last_poll_at` | последний резервный опрос звонков |
| `history_imported_at` | когда закончился первичный импорт |

## `managers`

| Поле | Смысл |
| --- | --- |
| `id` | наш id |
| `account_id` | аккаунт |
| `amo_user_id` | уникальный id пользователя amoCRM |
| `name` | имя из amoCRM |
| `email` | почта из amoCRM |
| `group_id` | группа amoCRM, если пришла |
| `is_active` | активен ли пользователь |
| `created_at`, `updated_at` | наши метки |

Уникальность: `(account_id, amo_user_id)`.

Имя меняется только при синхронизации из amoCRM.

## `contacts`

Локальная карточка для экрана и ссылки. Компания хранится на контакте: отдельной сущности «компания» в MVP нет.

| Поле | Смысл |
| --- | --- |
| `id` | наш id |
| `account_id` | аккаунт |
| `amo_contact_id` | id контакта |
| `name` | имя контакта |
| `company_name` | название компании |
| `amo_company_id` | id компании |
| `updated_at` | последнее обновление из amoCRM |

Уникальность: `(account_id, amo_contact_id)`.

Ссылка на контакт собирается при отдаче API:

```text
https://{amo_subdomain}.amocrm.ru/contacts/detail/{amo_contact_id}
```

Ссылка на сделку:

```text
https://{amo_subdomain}.amocrm.ru/leads/detail/{amo_lead_id}
```

В базу готовый URL не пишем: поддомен может смениться.

## `pipelines` и `pipeline_statuses`

Справочник человеческих названий стадий. Наши собственные стадии не заводим.

`pipelines`: `id`, `account_id`, `amo_pipeline_id`, `name`.

`pipeline_statuses`: `id`, `pipeline_id`, `amo_status_id`, `name`, `is_success`, `is_lost`, `sort`.

Активная сделка — статус, у которого `is_success` и `is_lost` ложны.

## `calls`

| Поле | Смысл |
| --- | --- |
| `id` | наш id |
| `account_id` | аккаунт |
| `amo_note_id` | id примечания |
| `external_call_id` | `params.uniq`, а если его нет — `amo_note_id` |
| `manager_id` | наш менеджер, может быть пустым |
| `amo_user_id` | id пользователя amoCRM, найденный по правилам сервиса |
| `contact_id` | наш контакт, может быть пустым |
| `amo_lead_id` | сделка, если определилась |
| `deal_link_status` | `linked`, `unresolved`, `ambiguous` |
| `direction` | `in` или `out` |
| `phone` | номер из примечания |
| `started_at` | время звонка |
| `duration_sec` | длительность |
| `recording_source_url` | исходный `params.link` |
| `recording_storage_key` | ключ объекта в `minio` |
| `recording_content_type` | MIME файла |
| `pipeline_id` | воронка на момент привязки |
| `deal_name` | название сделки |
| `deal_price` | бюджет |
| `deal_status_at_call_id` | id стадии в момент звонка |
| `deal_status_at_call_name` | название стадии в момент звонка |
| `current_deal_status_id` | текущий id стадии |
| `current_deal_status_name` | текущее название стадии |
| `processing_status` | см. [architecture.md](architecture.md) |
| `error` | JSON причины сбоя |
| `created_at`, `updated_at` | наши метки |

Уникальность: `(account_id, external_call_id)`.

`started_at` берётся из отдельного времени звонка в примечании. Если телефония его не присылает, используем время создания примечания. Это один из пунктов технической проверки на реальном звонке.

## `call_analysis`

Одна строка на звонок.

| Поле | Смысл |
| --- | --- |
| `id` | наш id |
| `call_id` | звонок, уникальный |
| `transcript_json` | массив реплик |
| `opening_score`, `needs_score`, `presentation_score`, `objections_score`, `closing_score` | целые 0–100 |
| `overall_score` | итог по весам, целое 0–100 |
| `opening_comment`, `needs_comment`, `presentation_comment`, `objections_comment`, `closing_comment` | текст этапа |
| `summary` | краткий вывод |
| `next_step_detected` | модель увидела зафиксированный следующий шаг |
| `ai_model` | имя модели |
| `prompt_version` | версия инструкции оценки |
| `created_at` | время записи оценки |

Элемент `transcript_json`:

```json
{
  "speaker": "manager",
  "start": 0.0,
  "end": 4.5,
  "text": "Добрый день, Алексей..."
}
```

`speaker` — только `manager` или `client`. `start` и `end` — секунды от начала записи.

## `settings`

Одна строка на аккаунт.

```json
{
  "min_call_duration_sec": 180,
  "import_days": 30,
  "timezone": "Europe/Moscow",
  "weights": {
    "opening": 0.15,
    "needs": 0.30,
    "presentation": 0.20,
    "objections": 0.20,
    "closing": 0.15
  },
  "user_sync_interval_hours": 6,
  "poll_interval_sec": 90,
  "poll_lookback_sec": 900,
  "recording_recheck_delays_sec": [60, 300, 900],
  "transcribe_concurrency": 2,
  "analyze_concurrency": 2,
  "prompt_version": "scorecard-v1"
}
```

Сумма `weights` обязана быть 1. Проверку делает `api` при сохранении.

## `telephony_extensions`

Запасной словарь, если в звонке нет id пользователя amoCRM.

| Поле | Смысл |
| --- | --- |
| `id` | наш id |
| `account_id` | аккаунт |
| `extension` | номер или идентификатор абонента телефонии |
| `amo_user_id` | кому принадлежит |

Уникальность: `(account_id, extension)`.

## `amo_events`

Технический журнал входящих событий.

| Поле | Смысл |
| --- | --- |
| `id` | наш id |
| `account_id` | аккаунт, если уже известен |
| `source` | `webhook` или `poll` |
| `payload` | исходное тело |
| `received_at` | когда увидели |
| `processed_at` | когда разбор закончился |
| `process_status` | `pending`, `processed`, `ignored`, `failed` |
| `call_id` | созданный или найденный звонок |

## Что сознательно не храним отдельными таблицами

Компания вложена в контакт. Агрегаты менеджера не материализуем: `api` считает средние запросом к `call_analysis` за период. Короткий звонок ниже порога не храним.
