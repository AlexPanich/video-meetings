# @video-meetings/llm

Фасад LLM. Код фич импортирует только его:

```ts
import { query } from '@video-meetings/llm'
import type { SDKMessage } from '@video-meetings/llm'
```

Реализация выбирается один раз при загрузке модуля по `LLM_PROVIDER`:

| `LLM_PROVIDER`          | Реализация                                                  |
| ----------------------- | ----------------------------------------------------------- |
| `local` (или не задана) | [`@video-meetings/llm-sdk`](../llm-sdk) — Qwen в Ollama     |
| `anthropic`             | `@anthropic-ai/claude-agent-sdk`, нужен `ANTHROPIC_API_KEY` |

Другое значение — ошибка при импорте. Выбранный провайдер экспортируется как `provider`.
В режиме `local` модуль Anthropic не импортируется, поэтому запросов к Anthropic нет — это
проверяет тест с перехватом `fetch`, `http/https.request` и `child_process.spawn`.

Фасад экспортирует `query`, `tool`, `createSdkMcpServer`, `AbortError` (ошибка отмены через
`abortController`, проверка — `instanceof`), `InMemorySessionStore` (хранилище сессий в памяти,
для тестов и разработки) и типы, в том числе `SessionStore` для своего хранилища и конфиги внешних
MCP-серверов (`McpStdioServerConfig`, `McpHttpServerConfig`, `McpSSEServerConfig`). Типы фасада — типы локального SDK, они
повторяют оригинал (подмножество полей и вариантов). Правила для кода фич (`tools: []`, `default`
в `switch` по типу сообщения, текст только из блоков `text`, `structured_output` как `unknown`) —
в [README `llm-sdk`](../llm-sdk/README.md#правила-для-кода-фич).

## Проверки

```bash
pnpm --filter @video-meetings/llm test         # unit + typecheck:compat
pnpm --filter @video-meetings/llm typecheck:compat
```

`typecheck:compat` компилирует `test/compat/feature.ts` («код фичи») дважды: с самим фасадом
(`src/index.ts`, локальный SDK) и с фасадом на `@anthropic-ai/claude-agent-sdk`, без `any` и приведений.
`test/compat/signatures.ts` сверяет локальные типы с опорной версией: опции и `prompt` локального
SDK принимает оригинал, а сообщения `assistant`, `result`, `system/init` и методы `Query` оригинала
подходят под локальные типы. Фасад приводит модуль Anthropic к локальным типам (`as unknown as`),
и эта проверка — то, что делает приведение безопасным.

Контрактный набор ходит в живую модель и запускается вручную:

```bash
pnpm --filter @video-meetings/llm test:contract
```

Провайдер и адрес модели (`LLM_PROVIDER`, `OLLAMA_URL`, `ANTHROPIC_API_KEY`) читаются из корневого
`.env`, заданные в shell имеют приоритет: например,
`LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... pnpm --filter @video-meetings/llm test:contract`.
Флаг `LLM_CONTRACT=1` выставляет сам конфиг `vitest.config.contract.ts`.

Сценарии (`test/contract/*.contract.ts`): простой ответ; вызов SDK-инструмента, `maxTurns` →
`error_max_turns`, deny в `PreToolUse` и в `canUseTool`; `structured_output`; `stream_event`,
`interrupt()` и `abortController`; `resume` и `forkSession`; внешний stdio-MCP-сервер (фикстура
`packages/llm-sdk/src/testing/fixtures/echo-mcp-server.mjs`).

Последний прогон против `LLM_PROVIDER=local` (Ollama, `qwen3:14b`, `num_ctx` 32768, 2026-11-15):
весь набор, все 13 сценариев, прошёл два раза подряд, расхождений с оригиналом не найдено. Прогона
против `@anthropic-ai/claude-agent-sdk` ещё не было, он ждёт ключа (#155).
