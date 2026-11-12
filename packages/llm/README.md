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

Типы фасада — типы локального SDK, они повторяют оригинал.

## Проверки

```bash
pnpm --filter @video-meetings/llm test         # unit + typecheck:compat
pnpm --filter @video-meetings/llm typecheck:compat
```

`typecheck:compat` компилирует `test/compat/feature.ts` («код фичи») дважды: с самим фасадом
(`src/index.ts`, локальный SDK) и с фасадом на `@anthropic-ai/claude-agent-sdk`, без `any` и приведений.

Контрактный набор ходит в живую модель и запускается вручную:

```bash
LLM_CONTRACT=1 LLM_PROVIDER=local OLLAMA_URL=http://<ip>:11434 pnpm --filter @video-meetings/llm test:contract
LLM_CONTRACT=1 LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... pnpm --filter @video-meetings/llm test:contract
```

Переменные читаются из корневого `.env`, заданные в shell имеют приоритет.
