# Сервис `analyzer`

Оценивает готовый транскрипт по пяти этапам и записывает итог. Запись не слушает и amoCRM не вызывает.

Модель выбирается переменными окружения (`LLM_MODEL`, ключ). В сохранённой строке остаётся фактическое имя модели. Версия инструкции берётся из `settings.prompt_version`.

Итоговое число считает сервис, не модель:

```text
overall = round(
  opening * weights.opening
  + needs * weights.needs
  + presentation * weights.presentation
  + objections * weights.objections
  + closing * weights.closing
)
```

Веса читаются из `settings` в момент обработки конкретного звонка. Смена весов не пересчитывает уже завершённые звонки.

## Вход

Очередь `calls.analyze`:

```json
{
  "message_id": "uuid",
  "call_id": "uuid",
  "attempt": 1,
  "enqueued_at": "2026-10-05T20:20:00+03:00"
}
```

Из базы по `call_id` сервис собирает пакет, который уходит в модель. В очередь этот пакет не кладётся.

```json
{
  "prompt_version": "scorecard-v1",
  "call": {
    "direction": "out",
    "duration_sec": 1458,
    "started_at": "2026-04-28T16:42:00+03:00"
  },
  "manager_name": "Анна Петрова",
  "contact_name": "Алексей Смирнов",
  "company_name": "ООО Альфа",
  "deal": {
    "name": "Поставка",
    "status_at_call_name": "Переговоры",
    "price": 150000
  },
  "transcript": [
    {
      "speaker": "manager",
      "start": 0.0,
      "end": 4.5,
      "text": "Добрый день, Алексей..."
    }
  ],
  "scorecard": ["opening", "needs", "presentation", "objections", "closing"]
}
```

Пустые имя менеджера, контакт или сделка передаются как `null`. Модель обязана оценить разговор и в этом случае.

Если `overall_score` у звонка уже заполнен, модель не вызывается и сообщение подтверждается без новой записи.

В начале работы статус звонка — `analyzing`. Одновременно выполняется не больше `settings.analyze_concurrency` заданий.

Текст инструкции `scorecard-v1` в этот черновик не входит. Контракт ограничен JSON, который модель обязана вернуть. Свободный текст вне JSON сервис не разбирает и считает ошибкой ответа.

Ожидаемый ответ модели:

```json
{
  "stages": {
    "opening": { "score": 85, "comment": "Хорошо установил контакт" },
    "needs": { "score": 70, "comment": "Выявил проблему, но не выяснил критерии выбора" },
    "presentation": { "score": 68, "comment": "Презентация слишком общая" },
    "objections": { "score": 55, "comment": "Слабо отработал возражение по стоимости" },
    "closing": { "score": 60, "comment": "Не зафиксирован следующий шаг" }
  },
  "summary": "Клиент заинтересован. Основная потребность выявлена.",
  "next_step_detected": false
}
```

`score` — целое от 0 до 100. `comment` и `summary` — непустые строки. Поле итога в ответе модели игнорируется, даже если оно есть.

## Выход

Обновление той же строки `call_analysis`:

| Поле | Откуда |
| --- | --- |
| `opening_score` и остальные четыре оценки | `stages.*.score` |
| парные `*_comment` | `stages.*.comment` |
| `summary` | `summary` |
| `next_step_detected` | `next_step_detected` |
| `overall_score` | формула весов |
| `ai_model` | фактическая модель |
| `prompt_version` | `settings.prompt_version` |
| `created_at` | время успешной записи |

Пример для весов по умолчанию и оценок 85, 70, 68, 55, 60:

```text
overall = round(85*0.15 + 70*0.30 + 68*0.20 + 55*0.20 + 60*0.15)
        = round(12.75 + 21 + 13.6 + 11 + 9)
        = round(67.35)
        = 67
```

После записи оценок `calls.processing_status=completed`. Следующей очереди нет. Экран увидит звонок при следующем `GET /api/calls`.

## Ошибки

| Ситуация | Результат |
| --- | --- |
| нет транскрипта | повтор, затем `failed`, `error.stage=analyze`, `error.message=transcript_missing` |
| модель недоступна | повтор, затем `failed` |
| ответ не JSON или нарушена схема | повтор, затем `failed`, `error.message=invalid_model_json` |
| оценка вне 0–100 | то же, что нарушение схемы |

Частичные оценки при ошибке не сохраняются. Пока статус не `completed`, предыдущая неуспешная попытка не оставляет на экране половину карточки.
