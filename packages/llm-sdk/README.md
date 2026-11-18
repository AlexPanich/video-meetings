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
- **`bypassPermissions` — только с `allowDangerouslySkipPermissions: true`.** Как и оригинал,
  без флага локальный SDK этот режим не включает: `query()` бросает исключение до запроса к
  модели, `setPermissionMode('bypassPermissions')` отклоняется (см. «Прод: Claude Agent SDK»).
- **Хуки проверяют `input.hook_event_name`.** Тип `HookInput` объединяет все события оригинала, а
  один `HookCallback` можно повесить на несколько событий.
- **Блоки `user`-сообщений — тоже по `type`.** `content` бывает строкой; в нём `tool_result` и
  (в режиме anthropic) другие блоки.
- **`switch` по `message.type` — с `default`.** У оригинала десятки вариантов `SDKMessage`
  (`stream_event`, `system/status`, `rate_limit_event` и др.), локальные типы объявляют только
  нужные фичам. Неизвестные сообщения пропускайте.
- **Текст — только из блоков `type === 'text'`.** В режиме anthropic `content` содержит и
  `thinking`, `tool_use` и другие блоки (`OtherContentBlock`), у них нет `.text`.
- **`structured_output` — `unknown`.** Проверяйте форму сами (type guard или zod), а провал —
  по `subtype !== 'success'` (исчерпанные повторы оба SDK отдают как
  `error_max_structured_output_retries`).
- **Отмена — `AbortError` из фасада.** Ловите `error instanceof AbortError`; после `interrupt()`
  не ждите ни `result`, ни его отсутствия (см. «Отличия от оригинала»).
- **Сессии между процессами — только через свой `sessionStore`.** Локально хранилище по умолчанию
  живёт в памяти процесса, оригинал пишет на диск: `resume` после перезапуска работает лишь с
  хранилищем, которое фича передаёт сама (см. «Сессии»).
- **В API — без `continue`, `resume` только после проверки владельца.** Область сессий — cwd
  процесса, хранилище по умолчанию общее на процесс: `continue: true` вернёт последнюю сессию
  _любого_ пользователя вместе с содержимым его встреч (в оригинале так же). `sessionId` храните в
  БД рядом с владельцем (встреча, пользователь) и передавайте в `resume` оттуда, а не из запроса
  клиента.
- **Без `resume` — `persistSession: false`.** Фоновая задача, которая не продолжает сессию, не
  должна оставлять историю ни в памяти процесса (локально), ни транскриптом на диске сервера
  (оригинал, см. «Прод»).

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
- `interrupt()` и `abortController` останавливают сессию (см. «Отмена»).
- Если Qwen всё же вернул рассуждение `<think>…</think>` в начале текста, SDK его отрезает.
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
- Обработчик получает вторым аргументом `{ signal }` — срабатывает при `interrupt()` и
  `abortController.abort()`. После отмены следующие вызовы ответа не выполняются, сессия кончается
  без `result`.
- SDK-серверы — только из `createSdkMcpServer()` этого пакета (через фасад так и есть), чужой
  `McpServer` — ошибка. Их обработчики вызываются напрямую, без MCP-транспорта. Внешние серверы
  (`stdio`, `http`, `sse`) — см. «Внешние MCP-серверы».

## Внешние MCP-серверы (фаза 4)

```ts
const servers: Record<string, McpServerConfig> = {
  files: { type: 'stdio', command: 'node', args: ['server.mjs'], env: { ROOT: '/data' } },
  remote: { type: 'http', url: 'https://mcp.example/mcp', headers: { Authorization: 'Bearer …' } },
  legacy: { type: 'sse', url: 'https://old.example/sse' },
}
query({ prompt, options: { tools: [], mcpServers: servers, allowedTools: ['mcp__files'] } })
```

- Клиент — `@modelcontextprotocol/sdk`: `stdio` запускает процесс (`type` можно не указывать),
  `http` — Streamable HTTP, `sse` — устаревший HTTP+SSE; `headers` уходят в каждый запрос.
  `env` добавляется к безопасному набору переменных (`HOME`, `PATH`, `SHELL`, `TERM`, `USER`,
  `LOGNAME`), а не ко всему окружению процесса; stderr сервера отбрасывается. Оригинал, судя по
  документации Claude Code, передаёт stdio-серверу окружение процесса целиком (не проверено без
  ключа, #155): всё, что нужно серверу, передавайте явно в `env`, а секреты API в окружении процесса
  с `query()` считайте доступными серверу (см. «Прод»).
- Серверы подключаются параллельно при первом `next()`, до `system/init`; инструменты берутся из
  `tools/list` (JSON Schema уходит модели как есть). Имена, права, хуки и ошибки — как у
  SDK-инструментов; аргументы проверяет сам сервер, его `isError` — `tool_result` с `is_error`.
  `timeout` конфига — таймаут вызова, мс (по умолчанию — 60 с MCP SDK).
- Не подключился за 30 с (нет программы, сервер недоступен, ошибка протокола) — `status: 'failed'`
  в `mcp_servers` `system/init`, сессия идёт без его инструментов.
- Сессия кончилась любым способом (`result`, `break`, `interrupt()`, `abortController`,
  исключение) — клиенты закрываются, процесс stdio-сервера завершается (SIGTERM, затем SIGKILL).

## Сессии (фаза 4)

```ts
const store = new InMemorySessionStore() // или своё хранилище: SessionStore
const first = await run('Запомни ЛИМОН-42', { sessionStore: store })
await run('Какое слово?', { sessionStore: store, resume: first.sessionId })
await run('Теперь ГРУША-7', { sessionStore: store, resume: first.sessionId, forkSession: true })
await run('Продолжим', { sessionStore: store, continue: true }) // последняя по mtime
```

- `resume: <id>` — модель получает историю сессии (сообщения, вызовы инструментов и их
  результаты), `session_id` сообщений тот же. Неизвестный id — исключение
  `No conversation found with session ID: <id>` до запросов к модели.
- `continue: true` — последняя сессия хранилища по `mtime` (`listSessions()` обязателен, иначе
  исключение); нет сессий — новая. При `resume` `continue` не действует.
- `forkSession: true` вместе с `resume`/`continue` — новый `session_id`, история копируется в
  новую сессию, исходная не меняется.
- Системный промпт и остальные опции берутся из нового `query()`: в хранилище пишется только
  история. Хук `SessionStart` при продолжении получает `source: 'resume'`.
- Новые сообщения хода дописываются в `append()` перед каждым `result` (поэтому `break` на
  `result` ход не теряет); ошибка `append()` — исключение из генератора. Ход, прерванный
  `interrupt()`, `abortController` или ошибкой Ollama, не сохраняется: в хранилище нет
  полуоконченных обменов. Ответвление, в котором не было ни одного хода, не создаётся. Ход,
  который не поместился в контекст (`error_during_execution` с `Context window exceeded`), тоже
  не сохраняется и убирается из истории: сессию можно продолжить следующим сообщением.
- Записи — `{ type: 'ollama_message', uuid, timestamp, session_id, message }`, ключ —
  `{ projectKey: <cwd, не буквы и цифры заменены на '-'>, sessionId }`. Записи других типов и
  битые (например, `tool_calls` не той формы) при загрузке пропускаются с предупреждением
  (`process.emitWarning`); если понятных записей нет совсем (сессию записал провайдер `anthropic`
  в то же хранилище) — исключение `Session <id> has no entries readable by the local SDK`, а не
  продолжение без контекста.
- `load()`/`listSessions()` ограничены `loadTimeoutMs` (по умолчанию 60 с, как в оригинале) и
  отменяются `abortController`: зависшее хранилище — исключение
  `sessionStore.load() timed out after N ms`, а не вечное ожидание.
- `persistSession: false` — ходы не сохраняются, такую сессию нельзя продолжить; вместе с
  `sessionStore` — исключение, как в оригинале. Два одновременных `query()` с `resume` одного id пишут в один ключ
  вперемешку — продолжайте сессию по очереди или ответвляйте (`forkSession`).
- Без `sessionStore` — общее на процесс хранилище в памяти на последние 100 сессий (старые
  вытесняются): сессии не переживают перезапуск. Для продолжения между процессами передайте своё
  хранилище (`append`, `load`, `listSessions`), например в БД. Хранилище по умолчанию ограничено
  числом сессий, но не размером: история хранится целиком, вместе с результатами инструментов
  (транскрипты встреч — сотни КБ), так что в API ставьте `persistSession: false` там, где нет
  `resume`, а для `resume` — своё хранилище. `InMemorySessionStore` (экспорт пакета и фасада) не
  ограничен и по числу — для тестов и разработки.

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

`interrupt()` и `abortController` не ждут хуки, `canUseTool` и обработчики, которые не слушают
`signal`: сессия завершается сразу, их результат отбрасывается.

- В `allowedTools`/`disallowedTools` — полное имя, `mcp__<сервер>` или `mcp__<сервер>__*` (все
  инструменты сервера). Шаблонов вроде `Bash(git:*)` нет.
- `acceptEdits` и `auto` для SDK-инструментов работают как `default`: встроенных инструментов
  правки файлов нет.
- `setPermissionMode()` меняет режим для следующих вызовов той же сессии.
- `bypassPermissions` требует `allowDangerouslySkipPermissions: true` в опциях `query()`; без
  него — исключение из генератора до запроса к модели, а `setPermissionMode('bypassPermissions')`
  отклоняется, режим не меняется.
- Каждый отказ (кроме `disallowedTools`) попадает в `permission_denials` сообщения `result`
  (`tool_name`, `tool_use_id`, `tool_input`).

## Хуки

`options.hooks` — `{ [событие]: [{ matcher?, hooks: [HookCallback] }] }`, хук вызывается как
`hook(input, toolUseID, { signal })`. Локально вызываются:

| Событие            | Когда                                                | matcher по        |
| ------------------ | ---------------------------------------------------- | ----------------- |
| `SessionStart`     | после `system/init`; `source` — `startup`/`resume`   | `source`          |
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
- Если и этого мало (длинный диалог, в том числе продолженный через `resume`), самые старые ходы
  «сообщение пользователя — ответ» убираются, а на их месте остаётся пометка
  `[N earlier messages of this conversation were omitted to fit the context window]`. Текущий ход
  (последнее сообщение пользователя и всё после него) не трогается.
- Усекается только запрос: история сессии и сообщения `user`/`tool_use_result` вызывающему коду
  остаются полными. В следующем запросе бюджет считается заново.
- Системный промпт и текущий ход не усекаются. Если не помещаются они, запрос не отправляется: агентный цикл заканчивается `result/error_during_execution` с
  `Context window exceeded: the request needs about N tokens, the input budget is M of num_ctx K`
  в `errors` (в потоковом `prompt` сессия ждёт следующее сообщение; ход в историю не попадает). Для длинных материалов
  давайте модели инструмент чтения по частям (`offset`/`limit`), а не вставляйте их в промпт.

## Структурированный ответ (фаза 3)

```ts
const schema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    decisions: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'decisions'],
  additionalProperties: false,
}

for await (const message of query({
  prompt: 'Сделай саммари встречи',
  options: { tools: [], outputFormat: { type: 'json_schema', schema } },
})) {
  if (message.type === 'result' && message.subtype === 'success') {
    console.log(message.structured_output) // unknown: проверьте форму сами (type guard / zod)
  }
}
```

- `outputFormat: { type: 'json_schema', schema }` — финальный ответ модели (без вызовов
  инструментов) должен быть JSON по схеме. Результат — `structured_output` в `result/success`:
  разобранный JSON как есть, тип `unknown`. В `result` остаётся текст ответа.
- Схема (JSON) с требованием ответить только JSON по ней добавляется в конец системного промпта:
  так модель видит поля и их `description`, в том числе когда `format` не уходит.
- Схема уходит в Ollama как `format`: вывод ограничивается грамматикой схемы. Грамматика не даёт
  модели вызвать инструмент, поэтому при инструментах обычные запросы идут без `format`, а
  повтор после ответа не по схеме — с `format` и без инструментов.
- Перед разбором снимается одна внешняя markdown-обёртка ` ```json … ``` ` (без `format`
  Qwen часто так оформляет JSON); текст вокруг JSON не допускается.
- Ответ проверяется по схеме (`z.fromJSONSchema` из zod 4). Не JSON или не по схеме — модель
  получает сообщение с описанием ошибок (путь и текст) и отвечает заново; если ответ оборвался
  по `num_predict`, к нему добавляется просьба отвечать короче. Всего **3 попытки** на сообщение
  пользователя, затем `result/error_max_structured_output_retries` (как в оригинале) с последней
  ошибкой в `errors`. Повторы
  считаются в `maxTurns`: лимит кончился раньше попыток — `error_max_turns` (если оба кончились
  на одном ответе — `error_max_structured_output_retries`). Неудачные попытки и сообщения об ошибках остаются
  в истории сессии и занимают контекст следующих сообщений потокового `prompt`.
- Схема, которую zod не разбирает, или `type` не `json_schema` — исключение из генератора до
  запроса к модели. Хук `Stop` вызывается только перед успешным `result`.

## Стриминг (фаза 3)

С `includePartialMessages: true` запрос к Ollama идёт потоком (NDJSON), и перед каждым полным
`assistant` приходят сообщения `stream_event` (`event` — событие Messages API):

- `message_start` (id — тот же, что у следующего `assistant`) → `content_block_start` /
  `content_block_delta` (`text_delta` для текста, `input_json_delta` с аргументами вызова целиком
  для `tool_use`) / `content_block_stop` → `message_delta` (`stop_reason`, `usage`) →
  `message_stop`.
- Рассуждение `<think>…</think>` в `text_delta` не попадает: пока начало ответа может оказаться
  тегом, текст придерживается. Склейка `text_delta` равна тексту полного `assistant`.
- Ollama присылает вызов инструмента целиком, поэтому `input_json_delta` один на вызов.
- Обрыв соединения посреди тела (`Ollama stream was interrupted before the response was
complete`), чанк `{ error }` (`Ollama failed: …`), строка не JSON или поток без `done` —
  исключение, а не обрезанный ответ. `OLLAMA_TIMEOUT_MS` ограничивает запрос вместе с чтением
  всего потока.

## Отмена (фаза 3)

| Способ                    | Что обрывает                                                       | Как кончается генератор                |
| ------------------------- | ------------------------------------------------------------------ | -------------------------------------- |
| `await q.interrupt()`     | текущий запрос к Ollama, хуки, `canUseTool`, инструменты, ожидание | без ошибки и без `result` (вся сессия) |
| `options.abortController` | то же                                                              | исключение `AbortError`, без `result`  |

- `AbortError` экспортирует фасад: `import { AbortError } from '@video-meetings/llm'`, проверка —
  `error instanceof AbortError`. Оба способа передают отмену в `signal` обработчиков, хуков и
  `canUseTool`; кто его не слушает, тех сессия не ждёт, их результат отбрасывается.
- `abort()` после того, как сессия уже отдала `result` и закончилась, ошибки не даёт.
- `interrupt()` не трогает `abortController` вызывающего кода (`signal.aborted` остаётся `false`)
  и возвращает `undefined` (квитанции об очереди, как в оригинале, нет).
- `SessionEnd` вызывается при любой отмене и получает свой `signal`, чтобы успеть доработать.
- `setPermissionMode()` меняет режим для следующих вызовов той же сессии (см. «Права»).

## Отличия от оригинала

Фаза 2:

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
- SDK-серверы вызываются без MCP-транспорта; `alwaysLoad`/`searchHint` у `tool()` игнорируются.
- Качество вызова инструментов зависит от Qwen: модель может назвать несуществующий инструмент
  или передать аргументы не по схеме — это уходит ей ошибкой, и она обычно исправляется на
  следующем ходу. Держите `maxTurns`.

Фаза 3:

- Повтор ответа по схеме идёт без инструментов (ограничение `format` Ollama); оригинал может
  вызывать инструменты и в повторе. Число попыток (3) фиксировано.
- `interrupt()` кончает всю сессию без `result`; оригинал отдаёт `result` прерванного хода и
  ждёт следующее сообщение потокового `prompt`. Код фичи не должен рассчитывать ни на то, ни на
  другое: после `interrupt()` закройте свой поток `prompt` и не ждите `success`.
- `stream_event` — только перечисленные события: нет `thinking`-блоков, `input_json_delta`
  приходит одним куском, `usage` в `message_start` нулевой. Если модель пришлёт текст после
  вызова инструмента, порядок блоков в событиях и в полном `assistant` разойдётся (Qwen
  присылает вызовы в конце ответа, на практике порядок совпадает).
- Типы: `outputFormat` — только `json_schema`; `structured_output` — `unknown`, как в оригинале.

Фаза 4:

- Хранилище по умолчанию — в памяти процесса, оригинал пишет транскрипт на диск
  (`~/.claude/projects`) и зеркалит в `sessionStore`. Формат записей свой: сессию локального SDK
  не продолжить в оригинале и наоборот.
- `persistSession: false` локально отключает запись в хранилище (в оригинале — запись транскрипта
  на диск); `loadTimeoutMs` ограничивает `load()` и `listSessions()` (в оригинале — `load()` и
  `listSubkeys()`).
- Окружение stdio-сервера — безопасный набор переменных плюс `env`; оригинал, по-видимому,
  передаёт окружение процесса целиком (см. «Внешние MCP-серверы»).
- Нет `sessionId`, `resumeSessionAt`, `sessionStoreFlush` и
  функций `listSessions()`/`getSessionMessages()`/`forkSession()` уровня модуля; `forkSession` при
  продолжении даёт `SessionStart` с `source: 'resume'`.
- Внешние MCP: нет `tools` (политик инструментов) и `alwaysLoad` в конфиге, ресурсов и промптов
  MCP, переподключения упавшего сервера; ждёт подключения всех серверов до `system/init`.

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
- `Ollama returned an unexpected response` — ответ 200 не той формы, тело в `cause`;
- потоковые (`includePartialMessages`): `Ollama stream was interrupted before the response was
complete` — соединение оборвалось посреди тела, `Ollama stream ended before the response was
complete` — поток кончился без `done`, `Ollama failed: <error>` — Ollama прислала ошибку в
  потоке;
- `AbortError` — отмена через `options.abortController` (см. «Отмена»).

Сырое тело ответа не попадает в текст ошибки: он может дойти до пользователя.

## Вторая машина: Ollama + Qwen + Whisper

Модель работает не на машине разработчика, а на отдельной машине в локальной сети с GPU.
Эталонная установка (2026-11-12): Windows 11, RTX 5080 16 ГБ, адрес `192.168.100.204`.

| Сервис                                                  | Адрес                                      | Модель                           |
| ------------------------------------------------------- | ------------------------------------------ | -------------------------------- |
| Ollama 0.40.16 (`ollama serve`)                         | `http://<ip>:11434`                        | `qwen3:14b` Q4_K_M, 11,9 ГБ VRAM |
| whisper.cpp v1.9.5 CUDA (`whisper-server`, `--convert`) | `http://<ip>:8000/v1/audio/transcriptions` | `large-v3-turbo-q8_0`            |

### Ollama и Qwen

1. Поставьте [Ollama](https://ollama.com/download) и скачайте модель: `ollama pull qwen3:14b`.
   Нужна модель с tool calling; 14b — самая крупная Qwen3, которая помещается в 16 ГБ рядом с
   Whisper.
2. Запускайте `ollama serve` скриптом с переменными окружения, а не трей-приложением: в
   эталонной установке трей-приложение переменные не подхватило. Скрипт положите в автозагрузку
   (Startup):

   ```powershell
   $env:OLLAMA_HOST = '0.0.0.0:11434'        # слушать сеть, а не только localhost
   $env:OLLAMA_CONTEXT_LENGTH = '32768'      # окно по умолчанию; SDK всё равно шлёт num_ctx
   $env:OLLAMA_FLASH_ATTENTION = '1'
   $env:OLLAMA_KV_CACHE_TYPE = 'q8_0'        # KV-кеш вдвое меньше, окно 32768 помещается в VRAM
   $env:OLLAMA_KEEP_ALIVE = '30m'            # модель не выгружается между запросами
   $env:OLLAMA_MAX_LOADED_MODELS = '1'
   ollama serve
   ```

3. Проверьте с машины разработчика: `curl http://<ip>:11434/api/tags` — в списке есть
   `qwen3:14b`. `ollama ps` на второй машине должен показывать `100% GPU`: частичная выгрузка на
   CPU замедляет генерацию в разы.

### Whisper

Транскрибация — не часть SDK (в Claude Agent SDK её нет), но работает на той же машине:

1. Соберите или скачайте [whisper.cpp](https://github.com/ggml-org/whisper.cpp) с CUDA и модель
   `ggml-large-v3-turbo-q8_0.bin`. Для `--convert` нужен `ffmpeg` в `PATH`: он перекодирует
   mp4 и другие форматы в WAV 16 кГц.
2. Запуск (тоже скриптом из автозагрузки):

   ```powershell
   whisper-server -m models\ggml-large-v3-turbo-q8_0.bin --host 0.0.0.0 --port 8000 `
     --inference-path /v1/audio/transcriptions --convert -l ru
   ```

3. Проверка — в ответе есть `text`:

   ```bash
   curl -F file=@sample.wav -F response_format=json http://<ip>:8000/v1/audio/transcriptions
   ```

### Сеть и `.env`

- Откройте в файрволе порты 11434 и 8000 только для IP машины разработчика (профиль сети
  Private). Авторизации и TLS у Ollama и whisper-server нет: сеть считается доверенной, наружу
  порты не публикуйте.
- В корневом `.env` машины разработчика:

  ```
  LLM_PROVIDER=local
  OLLAMA_URL=http://<ip>:11434
  OLLAMA_MODEL=qwen3:14b
  OLLAMA_NUM_CTX=32768
  # для транскрибации в api (apps/api/src/transcription), SDK их не читает
  WHISPER_URL=http://<ip>:8000
  WHISPER_LANGUAGE=ru
  ```

- Проверка всей цепочки — контрактный набор (см. «Разработка»).

### Особенности, которые учитывает код

- При переполнении `num_ctx` Ollama **молча** отбрасывает часть входа: ошибки нет, ответ просто
  неверный. Поэтому SDK сам считает размер запроса (см. «Контроль размера контекста»), а
  `OLLAMA_NUM_CTX` должен совпадать с окном, которое тянет видеокарта.
- Ответ по схеме валиден структурно, но поля Qwen заполняет неточно (задачи попадают в
  `decisions`, `actionItems` пустой): в системном промпте фичи описывайте каждое поле, а в
  схеме — `description`.
- Ответ whisper.cpp отличается от OpenAI: `language` — полное имя (`"russian"`, а не `"ru"`),
  поле `model` запроса игнорируется, в сегментах лишние `tokens`/`words`. Клиент транскрибации
  в api (`apps/api/src/transcription/whisper-client.ts`) нормализует ответ. Видео api отправляет
  как есть, поэтому `--convert` (и `ffmpeg`) на сервере обязателен.
- Qwen и Whisper вместе занимают ~15,0 из 16,3 ГБ VRAM: модель крупнее 14b или окно больше 32768
  рядом с Whisper не поместятся.
- Сервисы стартуют только после входа пользователя в Windows. Пока их нет, SDK сразу бросает
  `Ollama is unreachable at …` (см. «Ошибки»), а не зависает; первый запрос после простоя дольше
  на время загрузки модели в VRAM.
- Генерация идёт ~80 ток/с, разбор входа — ~3000 ток/с: агентный цикл по длинной встрече может
  идти минутами, `OLLAMA_TIMEOUT_MS` ограничивает каждый запрос, а не всю сессию.

## Прод: Claude Agent SDK

В проде `LLM_PROVIDER=anthropic` и `ANTHROPIC_API_KEY`; код фич не меняется. Но
`@anthropic-ai/claude-agent-sdk` — не HTTP-клиент: он запускает Claude Code дочерним процессом,
и у этого процесса по умолчанию есть встроенные инструменты с доступом к файлам и shell сервера.

- **Бинарник Claude Code на сервере.** Он приходит необязательной зависимостью под платформу
  (`@anthropic-ai/claude-agent-sdk-linux-x64`, `-linux-x64-musl` для Alpine и т. д.). pnpm ставит
  только пакет текущей платформы, поэтому `pnpm install` выполняйте в образе или на сервере, а не
  копируйте `node_modules` с Mac. Для своей сборки бинарника есть опция
  `pathToClaudeCodeExecutable` оригинала (в локальных типах её нет: это настройка развёртывания,
  а не фичи).
- **`tools: []` в каждом `query()`.** Отключает встроенные `Bash`, `Read`, `Write`, `WebFetch` и
  остальные. Без этого `allowedTools` ничего не ограничивает: в оригинале это список
  автоодобрения, а не фильтр.
- **Явные `allowedTools`** — полные имена инструментов фичи (`mcp__meeting__read_file`), а не
  весь сервер, и `disallowedTools` для того, что модели нельзя никогда.
- **Без интерактивных запросов прав.** На сервере некому ответить на запрос подтверждения, поэтому
  каждый вызов должен решаться без него: `allowedTools`, `canUseTool` или
  `permissionMode: 'bypassPermissions'` вместе с `allowDangerouslySkipPermissions: true` (без флага
  режим не включается ни в оригинале, ни локально). При `bypassPermissions` границу задают только `tools: []`,
  `disallowedTools` и хук `PreToolUse` с `deny`: держите набор инструментов фичи минимальным.
- **Содержимое файлов — недоверенный ввод.** Инструкции из транскрипта не должны расширять права:
  инструменты фичи принимают `fileId` из БД и сами проверяют владельца, а не доверяют аргументам
  модели.
- **Транскрипты на диске.** Оригинал по умолчанию пишет транскрипт каждой сессии в
  `~/.claude/projects/` (`CLAUDE_CONFIG_DIR`), а `sessionStore` у него — только зеркало. Для
  продукта это содержимое встреч (ПДн) на диске сервера без срока хранения, и `DELETE
/meetings/:id` его не удаляет. Фичи без `resume` ставят `persistSession: false`; для остальных
  `CLAUDE_CONFIG_DIR` — на эфемерный том или `tmpfs` с очисткой.
- **Секреты и stdio-серверы.** Stdio-сервер в оригинале, по-видимому, получает окружение процесса
  целиком, то есть `JWT_SECRET`, `DATABASE_URL`, `ANTHROPIC_API_KEY`. Подключайте только
  доверенные stdio-серверы, а сторонние — через обёртку, которая запускает их с явным `env`.
- **Сессии пользователей.** Без `continue`, `resume` — только с id из БД после проверки владельца
  (см. «Правила для кода фич»).
- **Канал до Whisper (и Ollama, если она остаётся).** Транскрибация не зависит от
  `LLM_PROVIDER`, поэтому и в проде аудио и видео встреч уходят на `WHISPER_URL`, а транскрипты
  возвращаются оттуда. У whisper-server нет ни TLS, ни авторизации: это ПДн по открытому HTTP.
  Ставьте его в изолированную сеть рядом с api или закрывайте обратным прокси с TLS (прокси должен
  принимать тело до `MAX_UPLOAD_BYTES`: api шлёт его с `Content-Length`, без chunked).
- **Проверка перед выкладкой:** `typecheck:compat` (входит в `pnpm test`) и ручной прогон
  контрактного набора с `LLM_PROVIDER=anthropic` (#155).

## Разработка

```bash
pnpm --filter @video-meetings/llm-sdk test    # unit на мок-транспорте, без сети
pnpm --filter @video-meetings/llm-sdk lint
pnpm --filter @video-meetings/llm-sdk build   # dist/ для сборки потребителей
```

Тестовые помощники лежат в `src/testing` и в сборку не входят: `ollama-mock.ts` — мок `fetch` для
Ollama (JSON и NDJSON-поток; запросы на loopback пропускает в настоящий `fetch`, на другие адреса —
ошибка), `mcp-servers.ts` — внешние MCP-серверы для тестов: `http` и `sse` на `127.0.0.1` со
случайным портом и путь к stdio-серверу `fixtures/echo-mcp-server.mjs` (отдельный процесс `node`).
Сеть и Ollama тестам не нужны.

В `exports` есть условие `source` → `src/index.ts`; фасад берёт исходники через `paths` в своём
`tsconfig.json` и alias в `vitest.config.ts`, поэтому тесты и линт работают без сборки.

### Контрактный набор

Unit-тесты проверяют SDK на моке, контрактный набор — на живой модели. Он лежит в фасаде
(`packages/llm/test/contract`), в `pnpm test` и pre-commit не входит и запускается вручную:

```bash
pnpm --filter @video-meetings/llm test:contract
```

- Провайдер и адрес берутся из корневого `.env`, набор покрывает «Критерии готовности» PRD;
  сценарии, переменные и результат последнего прогона — в
  [README фасада](../llm/README.md#проверки).
- Модель недетерминирована: упавший сценарий перезапустите, прежде чем искать ошибку. Стабильно
  падающий сценарий — либо ошибка SDK, либо отличие от оригинала, которое нужно описать в
  «Отличиях от оригинала».
