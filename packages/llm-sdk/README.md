# @video-meetings/llm-sdk

Локальная реализация публичного интерфейса
[`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
поверх [Ollama](https://ollama.com) (модель Qwen3 на машине в локальной сети). При разработке и в
тестах не расходуются платные токены Anthropic, а в проде приложение переходит на оригинальный SDK
настройкой `LLM_PROVIDER=anthropic`.

Код приложения импортирует не этот пакет, а фасад [`@video-meetings/llm`](../llm): он выбирает
реализацию по `LLM_PROVIDER`.

Опорная версия оригинального SDK — `devDependencies["@anthropic-ai/claude-agent-sdk"]` в
`package.json` (сейчас `0.3.322`). Типы `SDKMessage`, `Query`, `Options` повторяют её по именам и
формам полей. Совместимость проверяет `packages/llm/test/compat/feature.ts`: файл компилируется с
обеими реализациями.

## Что умеет (фаза 1)

```ts
import { query } from '@video-meetings/llm'

for await (const message of query({
  prompt: 'Столица Франции?',
  options: { systemPrompt: 'Отвечай кратко.' },
})) {
  if (message.type === 'result' && message.subtype === 'success') console.log(message.result)
}
```

- `query({ prompt, options })` возвращает `Query` — `AsyncGenerator<SDKMessage>` с методами
  `interrupt()` и `setPermissionMode()`.
- Поток сообщений: `system/init` (`session_id`, `model`, `tools: []`) → `assistant` (блок `text`)
  → `result/success` (`result`, `num_turns`, `duration_ms`, `usage` из счётчиков Ollama,
  `total_cost_usd: 0`). У всех сообщений один `session_id`, каждый вызов `query()` — новая сессия.
- `prompt` строкой — один ход. `prompt` как `AsyncIterable<SDKUserMessage>` — ход на каждое
  сообщение с общей историей; `content` может быть строкой или массивом блоков `text`.
- `options.model` перекрывает `OLLAMA_MODEL`, `options.systemPrompt` (строка или массив строк)
  уходит первым сообщением с ролью `system`.
- `interrupt()` обрывает текущий запрос к Ollama или ожидание следующего сообщения потокового
  `prompt`, генератор завершается без ошибки и без `result` (вся сессия, а не только ход;
  поведение оригинала повторит фаза 3).
- `maxTurns`, `allowedTools`, `disallowedTools`, `permissionMode` принимаются, но заработают вместе
  с инструментами (фаза 2): без инструментов один ход их не нарушает.
- Если Qwen вернул рассуждение `<think>…</think>` в начале текста, SDK его отрезает.

## Настройки (env)

| Переменная          | По умолчанию             | Назначение                                                    |
| ------------------- | ------------------------ | ------------------------------------------------------------- |
| `OLLAMA_URL`        | `http://localhost:11434` | Адрес Ollama, завершающий `/` отбрасывается                   |
| `OLLAMA_MODEL`      | `qwen3:14b`              | Модель, если не задан `options.model`                         |
| `OLLAMA_NUM_CTX`    | `32768`                  | `options.num_ctx` запроса; сверх него Ollama молча режет вход |
| `OLLAMA_TIMEOUT_MS` | `300000`                 | Таймаут одного запроса к Ollama, включая чтение ответа        |

Env читается при первом `next()` генератора. Некорректное `OLLAMA_NUM_CTX` или `OLLAMA_TIMEOUT_MS`
(не целое положительное число) и `OLLAMA_URL` не в виде `http(s)://…` — ошибка с именем
переменной, запрос не отправляется.

Пока нет контроля размера контекста: в потоковом режиме история растёт и целиком уходит в каждый
запрос, а вход сверх `num_ctx` Ollama молча отбрасывает. Контроль добавит фаза 2.

## Ошибки

Ошибки транспорта выбрасываются исключением из генератора (а не сообщением
`result/error_during_execution`):

- `Ollama is unreachable at <OLLAMA_URL>: <код>` — сеть, отказ в соединении, DNS;
- `Ollama request timed out after <N> ms` — превышен `OLLAMA_TIMEOUT_MS`;
- `Ollama responded with <статус>: <error из ответа>` — HTTP-ошибка Ollama (например, нет модели).

## Разработка

```bash
pnpm --filter @video-meetings/llm-sdk test    # unit на мок-транспорте, без сети
pnpm --filter @video-meetings/llm-sdk lint
pnpm --filter @video-meetings/llm-sdk build   # dist/ для сборки потребителей
```

В `exports` есть условие `source` → `src/index.ts`: тесты и линт фасада работают с исходниками
без сборки. Контрактный набор против живой модели — в [`packages/llm`](../llm/README.md).
