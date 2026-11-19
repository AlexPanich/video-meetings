// Мок Ollama для тестов саммари (unit и e2e): подменяет глобальный `fetch`, поэтому код идёт через
// настоящий фасад `@video-meetings/llm` (LLM_PROVIDER=local) и локальный SDK, а сеть и модель не
// нужны. Запросы на loopback уходят в настоящий `fetch`, на любой другой адрес — ошибка теста.
export const MOCK_OLLAMA_URL = 'http://ollama.test:11434'

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
  format?: unknown
}

export type MockHandler = (body: OllamaRequestBody, signal?: AbortSignal) => Promise<Response>

export interface SummaryJson {
  summary: string
  decisions: string[]
  actionItems: { task: string; assignee?: string; dueDate?: string }[]
  openQuestions: string[]
}

export const SAMPLE_SUMMARY: SummaryJson = {
  summary: 'Команда обсудила релиз 2.0 и распределила задачи.',
  decisions: ['Релиз 2.0 выпускаем в пятницу'],
  actionItems: [
    { task: 'Подготовить changelog', assignee: 'Алиса', dueDate: '2030-01-17' },
    { task: 'Проверить миграции' },
  ],
  openQuestions: ['Нужен ли отдельный стенд для QA?'],
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

const requestUrl = (input: string | URL | Request) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/** Ответ Ollama `POST /api/chat` без стриминга. */
export const chatReply = (content: string, message: Record<string, unknown> = {}) =>
  jsonResponse({
    model: 'qwen3:14b',
    created_at: '2030-01-15T10:00:00Z',
    message: { role: 'assistant', content, ...message },
    done: true,
    done_reason: 'stop',
    prompt_eval_count: 21,
    eval_count: 7,
  })

/** Итоговый ответ модели — JSON саммари. */
export const summaryReply =
  (summary: SummaryJson = SAMPLE_SUMMARY): MockHandler =>
  () =>
    Promise.resolve(chatReply(JSON.stringify(summary)))

/** Текст сообщений пользователя всех запросов одной строкой: материалы встречи, которые видела модель. */
export const userMessagesText = (requests: OllamaRequestBody[]) =>
  requests
    .flatMap((body) => body.messages.filter((message) => message.role === 'user'))
    .map((message) => message.content)
    .join('\n')

/** HTTP-ошибка Ollama. */
export const httpErrorReply =
  (status = 500, text = 'model crashed'): MockHandler =>
  () =>
    Promise.resolve(new Response(text, { status }))

/**
 * Ответ, который ждёт `release()`: пока он не отпущен, задача висит в `generating`.
 * Отмена запроса (`signal`) отвергает его, как настоящий `fetch`.
 */
export function heldReply(then: MockHandler = summaryReply()) {
  let release!: () => void
  let reached!: () => void
  const released = new Promise<void>((resolve) => (release = resolve))
  const called = new Promise<void>((resolve) => (reached = resolve))
  const handler: MockHandler = async (body, signal) => {
    reached()
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'))
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      void released.then(resolve)
    })
    return then(body, signal)
  }
  return { handler, release, called }
}

export interface LlmMock {
  /** Тела всех запросов к Ollama по порядку. */
  readonly requests: OllamaRequestBody[]
  /** Ответы на следующие запросы по порядку; когда очередь пуста — `fallback`. */
  enqueue(...handlers: MockHandler[]): void
  /** Ответ по умолчанию (изначально — `summaryReply()`). */
  setFallback(handler: MockHandler): void
  restore(): void
}

export function installLlmMock(): LlmMock {
  const realFetch = globalThis.fetch
  const requests: OllamaRequestBody[] = []
  const queue: MockHandler[] = []
  let fallback: MockHandler = summaryReply()

  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = requestUrl(input)
    if (!url.startsWith(MOCK_OLLAMA_URL)) {
      if (LOOPBACK.has(new URL(url).hostname)) return realFetch(input, init)
      throw new Error(`Unexpected request outside the Ollama mock: ${url}`)
    }
    if (typeof init?.body !== 'string') throw new Error('Ollama mock expects a JSON string body')
    const body = JSON.parse(init.body) as OllamaRequestBody
    requests.push(body)
    const handler = queue.shift() ?? fallback
    return handler(body, init?.signal ?? undefined)
  })

  return {
    requests,
    enqueue: (...handlers) => queue.push(...handlers),
    setFallback: (handler) => (fallback = handler),
    restore: () => vi.unstubAllGlobals(),
  }
}
