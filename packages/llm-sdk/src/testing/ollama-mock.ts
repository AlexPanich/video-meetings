// Мок-транспорт Ollama для unit-тестов (в сборку не входит, см. tsconfig.build.json).
// Подменяет глобальный `fetch`: сеть и живая Ollama не нужны. Запросы на loopback (тестовые
// MCP-серверы по http/sse из `mcp-servers.ts`) уходят в настоящий `fetch` и в `mock.calls` мока
// не попадают; запрос на любой другой адрес — ошибка теста, а не поход в сеть.
import type { SDKMessage, SDKUserMessage } from '../index.js'

export const OLLAMA_URL = 'http://ollama.test:11434'

export type FetchArgs = [input: string | URL | Request, init?: RequestInit]

const realFetch = globalThis.fetch

function requestUrl(input: FetchArgs[0]): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** Ставит мок вместо глобального `fetch`: Ollama — в мок, loopback — в настоящий `fetch`. */
function stubOllamaFetch(fetchMock: (...args: FetchArgs) => Promise<Response>): void {
  vi.stubGlobal('fetch', (...args: FetchArgs) => {
    const url = requestUrl(args[0])
    if (url.startsWith(OLLAMA_URL)) return fetchMock(...args)
    if (LOOPBACK.has(new URL(url).hostname)) return realFetch(...args)
    return Promise.reject(new Error(`Unexpected request outside the Ollama mock: ${url}`))
  })
}

export interface OllamaRequestMessage {
  role: string
  content: string
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[]
  tool_name?: string
}

export interface OllamaRequestBody {
  model: string
  messages: OllamaRequestMessage[]
  tools?: { type: string; function: { name: string } }[]
  stream?: boolean
  format?: unknown
  options?: { num_ctx?: number; num_predict?: number }
}

export interface ToolCall {
  name: string
  arguments: Record<string, unknown>
}

/** Ответ Ollama `POST /api/chat` без стриминга. */
export function ollamaReply(content: string, overrides: Record<string, unknown> = {}) {
  return {
    model: 'qwen3:14b',
    created_at: '2026-11-15T10:00:00Z',
    message: { role: 'assistant', content },
    done: true,
    done_reason: 'stop',
    prompt_eval_count: 21,
    eval_count: 7,
    ...overrides,
  }
}

/** Ответ Ollama с вызовами инструментов. */
export function toolCallReply(...calls: ToolCall[]) {
  return ollamaReply('', {
    message: {
      role: 'assistant',
      content: '',
      tool_calls: calls.map((call) => ({
        function: { name: call.name, arguments: call.arguments },
      })),
    },
  })
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Чанк потокового ответа Ollama (`stream: true`, NDJSON). */
export function streamChunk(content: string, overrides: Record<string, unknown> = {}) {
  return {
    model: 'qwen3:14b',
    created_at: '2026-11-15T10:00:00Z',
    message: { role: 'assistant', content },
    done: false,
    ...overrides,
  }
}

/** Последний чанк потока: `done: true`, причина остановки и счётчики токенов. */
export function streamDone(overrides: Record<string, unknown> = {}) {
  return streamChunk('', {
    done: true,
    done_reason: 'stop',
    prompt_eval_count: 21,
    eval_count: 7,
    ...overrides,
  })
}

/** Потоковый ответ: каждый чанк — строка JSON, как в `application/x-ndjson` Ollama. */
export function ndjsonResponse(chunks: unknown[]) {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
}

/**
 * Мок Ollama по сценарию: i-й запрос получает i-й ответ, после конца сценария повторяется
 * последний. Элемент сценария — тело JSON или готовый `Response` (например, `ndjsonResponse`).
 */
export function scriptedOllama(...replies: unknown[]) {
  let index = 0
  const fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>(() => {
    const reply = replies[Math.min(index, replies.length - 1)]
    index += 1
    return Promise.resolve(reply instanceof Response ? reply.clone() : jsonResponse(reply))
  })
  stubOllamaFetch(fetchMock)
  return fetchMock
}

/** Мок Ollama, который не отвечает, пока запрос не отменят: отклоняется `signal.reason`. */
export function hangingOllama() {
  const fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        // Как настоящий fetch: уже отменённый сигнал отклоняет запрос сразу.
        if (init?.signal?.aborted) reject(init.signal.reason)
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      }),
  )
  stubOllamaFetch(fetchMock)
  return fetchMock
}

/**
 * Потоковый ответ, который отдаёт первые чанки и зависает до отмены запроса: тело
 * отклоняется `signal.reason`, как у настоящего `fetch`.
 */
export function hangingStreamResponse(chunks: unknown[], signal: AbortSignal | null | undefined) {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`))
      if (signal?.aborted) controller.error(signal.reason)
      signal?.addEventListener('abort', () => controller.error(signal.reason))
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
}

export function requestBody(args: FetchArgs): OllamaRequestBody {
  const [, init] = args
  return JSON.parse(init?.body as string) as OllamaRequestBody
}

export function requests(fetchMock: { mock: { calls: FetchArgs[] } }): OllamaRequestBody[] {
  return fetchMock.mock.calls.map((args) => requestBody(args))
}

export function requestSignal(fetchMock: { mock: { calls: FetchArgs[] } }, index = 0) {
  return fetchMock.mock.calls[index]?.[1]?.signal ?? undefined
}

export async function collect(iterable: AsyncIterable<SDKMessage>): Promise<SDKMessage[]> {
  const messages: SDKMessage[] = []
  for await (const message of iterable) messages.push(message)
  return messages
}

export async function* userMessages(...texts: string[]): AsyncIterable<SDKUserMessage> {
  for (const text of texts) {
    yield {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: '',
    }
  }
}

/** Последнее сообщение — `result`, иначе тест падает с понятным текстом. */
export function lastResult(messages: SDKMessage[]) {
  const result = messages.at(-1)
  if (result?.type !== 'result') throw new Error(`последнее сообщение — ${result?.type}`)
  return result
}

export function stubOllamaEnv(): void {
  vi.stubEnv('OLLAMA_URL', OLLAMA_URL)
  vi.stubEnv('OLLAMA_MODEL', 'qwen3:14b')
  vi.stubEnv('OLLAMA_NUM_CTX', '32768')
  vi.stubEnv('OLLAMA_TIMEOUT_MS', '5000')
}
