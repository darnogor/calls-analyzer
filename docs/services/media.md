# Сервис `media`

Скачивает запись разговора и кладёт копию в хранилище. С amoCRM не разговаривает. Транскрипцию не строит.

Способ получения файла зависит от поля `source.type`. В первой версии реализован только `url`. Тип `telephony` описан как вход, который вернёт управляемую ошибку, пока нет выбранного провайдера.

## Вход

Очередь `calls.audio.fetch`:

```json
{
  "message_id": "uuid",
  "call_id": "uuid",
  "attempt": 1,
  "enqueued_at": "2026-10-05T20:15:00+03:00",
  "source": {
    "type": "url",
    "url": "https://telephony.example/recordings/abc"
  }
}
```

Допустимые значения `source.type`: `url`, `telephony`.

Для `url` обязательны `source.url`. Для `telephony` обязательны `source.provider` и `source.external_id`. Тело `telephony` сервис принимает и завершает попытку ошибкой `telephony_provider_not_configured`, без скачивания. После трёх таких попыток звонок станет `failed`. Это сделано специально: конвейер не молчит, если `crm-sync` опубликовал ещё не поддержанный источник.

Дополнительно сервис читает строку `calls` по `call_id`. Если `recording_storage_key` уже заполнен, новое скачивание не выполняется и сразу публикуется выходное сообщение.

Переменные окружения: адрес, бакет и ключи `minio`. Для будущего `telephony` — секрет провайдера, когда он появится.

## Выход

### Файл

Объект в бакете `recordings`:

```text
calls/{call_id}.{ext}
```

`ext` берётся из `Content-Type` ответа или из пути URL: `mp3`, `wav`, `ogg`, `mpeg`. Если тип не распознан, расширение `bin`, а исходный `Content-Type` всё равно пишется в `recording_content_type`.

### Поля звонка

Перед скачиванием: `processing_status=audio_fetch`.

После успешной записи объекта:

| Поле | Значение |
| --- | --- |
| `recording_storage_key` | `calls/{call_id}.{ext}` |
| `recording_content_type` | MIME |
| `processing_status` | не меняется на финальный; следующее состояние поставит `transcriber` |

### Сообщение `calls.transcribe`

```json
{
  "message_id": "uuid",
  "call_id": "uuid",
  "attempt": 1,
  "enqueued_at": "2026-10-05T20:16:00+03:00",
  "audio": {
    "bucket": "recordings",
    "key": "calls/58374.mp3",
    "content_type": "audio/mpeg"
  }
}
```

### Ошибки скачивания

| Ситуация | Результат |
| --- | --- |
| ответ 404 или 410 | сразу `processing_status=recording_missing`, следующего сообщения нет |
| таймаут, сеть, 408, 429, 5xx | повтор до 3 попыток, затем `failed`, `error.stage=audio` |
| пустое тело файла | то же, что сеть: повтор, затем `failed` |
| `source.type=telephony` без настроенного провайдера | повтор, затем `failed`, `error.message=telephony_provider_not_configured` |

`recording_source_url` этот сервис не изменяет.
