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
  `mcpServers` и `allowedTools` (см. «Инструменты и агентный цикл»).
- **Хуки проверяют `input.hook_event_name`.** Тип `HookInput` объединяет все события оригинала, а
  один `HookCallback` можно повесить на несколько событий.
- **Блоки `user`-сообщений — тоже по `type`.** `content` бывает строкой; в нём `tool_result` и
  (в режиме anthropic) другие блоки.
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
- Если Qwen всё же вернул рассуждение `<think>…</think>` в начале текста, SDK его отрезает.
- `interrupt()` возвращает `undefined` (квитанции об очереди, как в оригинале, нет).
- `modelUsage.maxOutputTokens` равен `OLLAMA_NUM_CTX`: отдельного лимита вывода нет, вход и выход
  делят одно окно. В оригинале это лимит вывода модели.

## Инструменты и агентный цикл (фаза 2)

Инструменты фичи — in-process MCP-сервер из `createSdkMcpServer()`, аргументы описывает zod-форма
(zod 4; схемы zod 3 — ошибка при создании сервера). Полный пример с правами и хуками —
[`packages/llm/test/compat/feature.ts`](../llm/test/compat/feature.ts).

```ts
import { z } from 'zod'
import { createSdkMcpServer, query, tool } from '@video-meetings/llm'

const readFile = tool(
  'read_file',
  'Читает часть файла встречи',
  { fileId: z.string(), offset: z.number().int().min(0), limit: z.number().int().positive() },
  async ({ fileId, offset, limit }) => ({
    content: [{ type: 'text', text: (await load(fileId)).slice(offset, offset + limit) }],
  }),
)

const meeting = createSdkMcpServer({ name: 'meeting', version: '1.0.0', tools: [readFile] })

for await (const message of query({
  prompt: 'Сделай саммари встречи f1',
  options: {
    tools: [],
    mcpServers: { meeting },
    allowedTools: ['mcp__meeting__read_file'],
    maxTurns: 10,
  },
})) {
  if (message.type === 'result') console.log(message.subtype, message.permission_denials)
}
```

- Имя инструмента для модели, прав и хуков — `mcp__<ключ в mcpServers>__<имя>` (ключ записи, а не
  `name` сервера). Список имён — в `system/init` (`tools`), серверы — в `mcp_servers`
  (`status: 'connected'`).
- Инструменты уходят в Ollama как function tools (`tools` запроса), JSON Schema строится из
  zod-формы (`z.toJSONSchema`, `io: 'input'`). Поле, которое JSON Schema не выражает (`z.date()`,
  `transform`), уходит модели как произвольное значение; аргументы всё равно проверяет zod.
- Агентный цикл на сообщение пользователя: `assistant` (блоки `text`, если есть текст, и
  `tool_use` с id `toolu_…`) → `user` с блоками `tool_result` (`tool_use_id`, `is_error`) и
  `tool_use_result` (сырой `CallToolResult`; при нескольких вызовах — массив) → следующий запрос к
  модели. Цикл кончается ответом без вызовов (`result/success`) или `maxTurns`.
- `maxTurns` — лимит запросов к модели на одно сообщение пользователя. Когда он исчерпан, а модель
  снова вызвала инструменты, вызовы выполняются, после их `user`-сообщения приходит
  `result/error_max_turns` (`is_error: true`, `errors`). Без `maxTurns` лимита нет.
- Вызовы одного ответа выполняются по очереди. Ошибки не роняют сессию, а уходят модели в
  `tool_result` с `is_error: true`, и цикл продолжается: неизвестный или запрещённый инструмент,
  отказ в правах, аргументы не по схеме, исключение обработчика, результат не формы
  `{ content: [...] }`. `isError: true` из обработчика тоже даёт `is_error`.
- Модели уходит текст блоков `text` результата через `\n`, прочие блоки (`image` и т. п.) —
  пометкой `[<type>]`.
- Обработчик получает вторым аргументом `{ signal }` — срабатывает при `interrupt()`. После
  `interrupt()` следующие вызовы ответа не выполняются, сессия кончается без `result`.
- В `mcpServers` принимаются только серверы из `createSdkMcpServer()` этого пакета (через фасад
  так и есть); `stdio`/`http`/`sse` и чужой `McpServer` — ошибка (внешние серверы — фаза 4).
  Обработчики вызываются напрямую, без MCP-транспорта.

## Права

Порядок решения по каждому вызову:

1. `disallowedTools` — инструмент не уходит модели и не выполняется ни при каких правах (вызов по
   имени — «No such tool available»).
2. Хуки `PreToolUse` (по порядку объявления): `deny` любого хука — отказ с его
   `permissionDecisionReason`; исключение хука — тоже отказ (см. «Хуки»); `updatedInput`
   заменяет ввод; `allow` разрешает без проверок ниже; `ask`/`defer` — обычная проверка. Все хуки
   получают исходный `tool_input` и не видят правок друг друга; при нескольких `updatedInput`
   действует последний по порядку объявления, предыдущие отбрасываются. Итоговый ввод в любом
   случае проверяется схемой инструмента.
3. `permissionMode: 'plan'` — инструменты не выполняются (отказ), модель отвечает текстом.
4. `allow` хука, `permissionMode: 'bypassPermissions'` или инструмент в `allowedTools` — выполнить.
5. Иначе решает `canUseTool(name, input, { signal, toolUseID })`. Он возвращает
   `{ behavior: 'allow', updatedInput? }` или `{ behavior: 'deny', message }` (`message` уходит
   модели). Исключение `canUseTool` — отказ. Без `canUseTool` и в режиме `dontAsk` — отказ.

`interrupt()` не ждёт хуки, `canUseTool` и обработчики, которые не слушают `signal`: сессия
завершается сразу, их результат отбрасывается.

- В `allowedTools`/`disallowedTools` — полное имя, `mcp__<сервер>` или `mcp__<сервер>__*` (все
  инструменты сервера). Шаблонов вроде `Bash(git:*)` нет.
- `acceptEdits` и `auto` для SDK-инструментов работают как `default`: встроенных инструментов
  правки файлов нет.
- `setPermissionMode()` меняет режим для следующих вызовов той же сессии.
- Каждый отказ (кроме `disallowedTools`) попадает в `permission_denials` сообщения `result`
  (`tool_name`, `tool_use_id`, `tool_input`).

## Хуки

`options.hooks` — `{ [событие]: [{ matcher?, hooks: [HookCallback] }] }`, хук вызывается как
`hook(input, toolUseID, { signal })`. Локально вызываются:

| Событие            | Когда                                                | matcher по        |
| ------------------ | ---------------------------------------------------- | ----------------- |
| `SessionStart`     | после `system/init`; `source` всегда `startup`       | `source`          |
| `UserPromptSubmit` | перед каждым сообщением пользователя (`prompt`)      | —                 |
| `PreToolUse`       | перед проверкой прав каждого вызова                  | имени инструмента |
| `PostToolUse`      | после успешного обработчика (`tool_response`)        | имени инструмента |
| `Stop`             | перед `result/success` (`last_assistant_message`)    | —                 |
| `SessionEnd`       | при любом завершении сессии; `reason` всегда `other` | `reason`          |

- matcher: нет, пусто или `*` — все; только буквы, цифры, `_` и `|` — точные значения через `|`;
  иначе — регулярное выражение (поиск подстроки, `mcp__meeting__.*`). Некорректное выражение не
  подходит ни к чему. У событий без значения (`UserPromptSubmit`, `Stop`) срабатывают только
  matcher без шаблона.
- Действует только `hookSpecificOutput` у `PreToolUse` (`permissionDecision`, `updatedInput`, см.
  «Права»). `continue`, `decision`, `systemMessage` и прочие поля `HookJSONOutput` принимаются, но
  игнорируются: `Stop` не может продолжить цикл, `UserPromptSubmit` — заблокировать
  сообщение.
- Исключение хука не роняет сессию и сообщается через `process.emitWarning` (код
  `LLM_SDK_HOOK_FAILED`). Исключение `PreToolUse` — **отказ** в вызове
  (`PreToolUse hook failed: …` уходит модели, вызов — в `permission_denials`): при
  `bypassPermissions` охранный хук — единственная защита, и его сбой не должен пропускать вызов.
  Исключения остальных событий — хук пропускается (как `onFailure: 'continue'` в оригинале).
- `PostToolUse` не вызывается при ошибке инструмента или отказе; `PostToolUseFailure` и прочие
  события оригинала локально не вызываются, но объявлены в типе `HookInput`
  (`OtherHookEvent`), чтобы `HookCallback` оригинала и локальный были совместимы.
- `SessionEnd` получает свой `signal`, который не срабатывает от `interrupt()`, — чтобы успеть
  доработать.

## Контроль размера контекста

Вход сверх `num_ctx` Ollama молча отбрасывает, поэтому
SDK перед каждым запросом оценивает его объём и при необходимости усекает результаты инструментов.

- Бюджет входа — `OLLAMA_NUM_CTX` минус запас под ответ: четверть окна, но не больше 4096 токенов
  (вход и выход делят одно окно). При `32768` — 28672 токена. Ответ ограничивается
  `num_predict` = окно минус оценка входа (не меньше запаса), иначе длинный ответ вышел бы за
  `num_ctx` и Ollama сдвинула бы окно, отбросив начало входа. Обрезанный ответ —
  `stop_reason: 'max_tokens'`; `modelUsage[…].maxOutputTokens` в `result` — `num_predict`
  последнего запроса.
- Оценка: ≈3 символа на токен плюс 8 служебных токенов на сообщение, с учётом описаний
  инструментов и аргументов вызовов. После каждого ответа оценка уточняется по
  `prompt_eval_count`, но только в сторону уменьшения символов на токен, чтобы не недооценить вход.
- Если вход не помещается, усекаются результаты инструментов, начиная со старых. От результата
  остаётся начало и пометка `[truncated: N of M characters removed to fit the context window]`;
  пары «вызов — результат» сохраняются, модель видит, что данные были.
- Если и этого мало (длинная цепочка: пометки и аргументы вызовов тоже занимают место), самые
  старые обмены «вызов — результаты» убираются целиком, а на их месте остаётся одна пометка
  `[N earlier tool calls and their results were omitted to fit the context window]`.
- Результаты последнего обмена усекаются, только если без этого не помещается никак.
- Усекается только запрос: история сессии и сообщения `user`/`tool_use_result` вызывающему коду
  остаются полными. В следующем запросе бюджет считается заново.
- Системный промпт, сообщения пользователя и ответы модели не усекаются. Если не помещаются они,
  запрос не отправляется: агентный цикл заканчивается `result/error_during_execution` с
  `Context window exceeded: the request needs about N tokens, the input budget is M of num_ctx K`
  в `errors` (в потоковом `prompt` сессия ждёт следующее сообщение). Для длинных материалов
  давайте модели инструмент чтения по частям (`offset`/`limit`), а не вставляйте их в промпт.

## Отличия от оригинала (фаза 2)

- Сообщения `prompt` с ролью `assistant` (`message.role` у `SDKUserMessage`) уходят модели как
  сообщения пользователя; из массива `content` берутся только блоки `text`.
- В потоковом `prompt` счётчик ходов (`maxTurns`, `num_turns`, `usage` в `result`) свой у каждого
  сообщения пользователя.
- Хуки: только перечисленные события, действует только решение `PreToolUse` (см. «Хуки»);
  `transcript_path` — пустая строка, транскрипт не пишется. Сбой хука `PreToolUse` — отказ
  (строже оригинала, где по умолчанию сбой хука действие не блокирует).
- Вызовы из одного ответа модели выполняются по очереди, а не параллельно.
- Права: нет шаблонов с аргументами в `allowedTools`, нет интерактивного `ask`, `acceptEdits`/
  `auto` равны `default`.
- Только SDK-серверы в `mcpServers`, без MCP-транспорта; `alwaysLoad`/`searchHint` у `tool()`
  игнорируются.
- Качество вызова инструментов зависит от Qwen: модель может назвать несуществующий инструмент
  или передать аргументы не по схеме — это уходит ей ошибкой, и она обычно исправляется на
  следующем ходу. Держите `maxTurns`.

## Настройки (env)

| Переменная          | По умолчанию             | Назначение                                                    |
| ------------------- | ------------------------ | ------------------------------------------------------------- |
| `OLLAMA_URL`        | `http://localhost:11434` | Адрес Ollama, завершающий `/` отбрасывается                   |
| `OLLAMA_MODEL`      | `qwen3:14b`              | Модель, если не задан `options.model`                         |
| `OLLAMA_NUM_CTX`    | `32768`                  | `options.num_ctx` запроса; сверх него Ollama молча режет вход |
| `OLLAMA_TIMEOUT_MS` | `300000`                 | Таймаут одного запроса к Ollama, включая чтение ответа        |

Env читается при первом `next()` генератора. Некорректное `OLLAMA_NUM_CTX` или `OLLAMA_TIMEOUT_MS`
(не целое положительное число) и `OLLAMA_URL` не в виде `http(s)://…` — ошибка с именем
переменной, запрос не отправляется. `OLLAMA_NUM_CTX` задаёт и бюджет входа (см. «Контроль размера
контекста»).

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
