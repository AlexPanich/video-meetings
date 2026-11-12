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
формам полей (подмножество полей и вариантов). Совместимость проверяет `packages/llm/test/compat`:
`feature.ts` компилируется с обеими реализациями, а `signatures.ts` сверяет сигнатуры с опорной
версией в обе стороны — обновление оригинала сразу покажет расхождение.

## Правила для кода фич

- **`tools: []` обязательно.** В Claude Agent SDK `allowedTools` — список автоодобрения, а не
  фильтр: без `tools: []` прод-агент получит встроенные `Bash`, `Read`, `Write` и т. д. Локально
  встроенных инструментов нет, и непустой `tools` — ошибка. Инструменты фич задаются через
  `mcpServers` и `allowedTools` (фаза 2).
- **`switch` по `message.type` — с `default`.** У оригинала десятки вариантов `SDKMessage`
  (`stream_event`, `system/status`, `rate_limit_event` и др.), локальные типы объявляют только
  нужные фичам. Неизвестные сообщения пропускайте.
- **Текст — только из блоков `type === 'text'`.** В режиме anthropic `content` содержит и
  `thinking`, `tool_use` и другие блоки (`OtherContentBlock`), у них нет `.text`.

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
- Рассуждение Qwen3 выключено (`think: false` в запросе): оно занимает сотни токенов на ход и
  вытесняет контекст.
- `interrupt()` обрывает текущий запрос к Ollama или ожидание следующего сообщения потокового
  `prompt`, генератор завершается без ошибки и без `result` (вся сессия, а не только ход;
  поведение оригинала повторит фаза 3).
- `maxTurns`, `allowedTools`, `disallowedTools`, `permissionMode` принимаются, но заработают вместе
  с инструментами (фаза 2): без инструментов один ход их не нарушает.
- Если Qwen всё же вернул рассуждение `<think>…</think>` в начале текста, SDK его отрезает.
- `interrupt()` возвращает `undefined` (квитанции об очереди, как в оригинале, нет).
- `modelUsage.maxOutputTokens` равен `OLLAMA_NUM_CTX`: отдельного лимита вывода нет, вход и выход
  делят одно окно. В оригинале это лимит вывода модели.

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
- `Ollama responded with <статус>: <error из ответа>` — HTTP-ошибка Ollama (например, нет модели);
  если тело не JSON Ollama (например, HTML прокси) — только статус, тело в `cause`;
- `Ollama returned an unexpected response` — ответ 200 не той формы, тело в `cause`.

Сырое тело ответа не попадает в текст ошибки: он может дойти до пользователя.

## Разработка

```bash
pnpm --filter @video-meetings/llm-sdk test    # unit на мок-транспорте, без сети
pnpm --filter @video-meetings/llm-sdk lint
pnpm --filter @video-meetings/llm-sdk build   # dist/ для сборки потребителей
```

В `exports` есть условие `source` → `src/index.ts`: тесты и линт фасада работают с исходниками
без сборки. Контрактный набор против живой модели — в [`packages/llm`](../llm/README.md).
