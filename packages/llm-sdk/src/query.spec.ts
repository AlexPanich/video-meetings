import { query } from './index.js'
import type { SDKMessage, SDKUserMessage } from './index.js'

const OLLAMA_URL = 'http://ollama.test:11434'

type FetchArgs = [input: string | URL | Request, init?: RequestInit]

/** Ответ Ollama `POST /api/chat` без стриминга. */
function ollamaReply(content: string, overrides: Record<string, unknown> = {}) {
  return {
    model: 'qwen3:14b',
    created_at: '2026-11-12T10:00:00Z',
    message: { role: 'assistant', content },
    done: true,
    done_reason: 'stop',
    total_duration: 1_000_000,
    prompt_eval_count: 21,
    eval_count: 7,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Подменяет `fetch` мок-транспортом Ollama и возвращает шпиона. */
function mockOllama(handler: (...args: FetchArgs) => Promise<Response> | Response) {
  const fetchMock = vi.fn(handler)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function requestUrl(args: FetchArgs): string {
  const [input] = args
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function requestBody(args: FetchArgs): {
  model: string
  messages: { role: string; content: string }[]
  stream?: boolean
  options?: { num_ctx?: number }
} {
  const [, init] = args
  return JSON.parse(String(init?.body)) as ReturnType<typeof requestBody>
}

async function collect(iterable: AsyncIterable<SDKMessage>): Promise<SDKMessage[]> {
  const messages: SDKMessage[] = []
  for await (const message of iterable) messages.push(message)
  return messages
}

async function* userMessages(...texts: string[]): AsyncIterable<SDKUserMessage> {
  for (const text of texts) {
    yield {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: '',
    }
  }
}

beforeEach(() => {
  vi.stubEnv('OLLAMA_URL', OLLAMA_URL)
  vi.stubEnv('OLLAMA_MODEL', 'qwen3:14b')
  vi.stubEnv('OLLAMA_NUM_CTX', '32768')
  vi.stubEnv('OLLAMA_TIMEOUT_MS', '5000')
})

describe('query(): поток сообщений одного хода', () => {
  it('отдаёт system/init → assistant (text) → result/success', async () => {
    mockOllama(() => jsonResponse(ollamaReply('Париж')))

    const messages = await collect(query({ prompt: 'Столица Франции?' }))

    expect(messages.map((m) => m.type)).toEqual(['system', 'assistant', 'result'])

    const [init, assistant, result] = messages
    if (init.type !== 'system' || init.subtype !== 'init') throw new Error('нет system/init')
    expect(init.session_id).toEqual(expect.any(String))
    expect(init.session_id).not.toBe('')
    expect(init.model).toBe('qwen3:14b')
    expect(init.tools).toEqual([])

    if (assistant.type !== 'assistant') throw new Error('нет assistant')
    expect(assistant.message.content).toEqual([{ type: 'text', text: 'Париж' }])
    expect(assistant.parent_tool_use_id).toBeNull()
    expect(assistant.session_id).toBe(init.session_id)

    if (result.type !== 'result' || result.subtype !== 'success') throw new Error('нет success')
    expect(result.result).toBe('Париж')
    expect(result.is_error).toBe(false)
    expect(result.num_turns).toBe(1)
    expect(result.duration_ms).toEqual(expect.any(Number))
    expect(result.duration_ms).toBeGreaterThanOrEqual(0)
    expect(result.total_cost_usd).toBe(0)
    expect(result.session_id).toBe(init.session_id)
    expect(result.usage).toMatchObject({ input_tokens: 21, output_tokens: 7 })
  })

  it('каждый вызов query() начинает новую сессию', async () => {
    mockOllama(() => jsonResponse(ollamaReply('ok')))

    const [first] = await collect(query({ prompt: 'a' }))
    const [second] = await collect(query({ prompt: 'b' }))

    expect(first.session_id).not.toBe(second.session_id)
  })

  it('объект Query — это AsyncGenerator с interrupt() и setPermissionMode()', () => {
    mockOllama(() => jsonResponse(ollamaReply('ok')))

    const q = query({ prompt: 'hi' })

    expect(typeof q[Symbol.asyncIterator]).toBe('function')
    expect(typeof q.next).toBe('function')
    expect(typeof q.return).toBe('function')
    expect(typeof q.throw).toBe('function')
    expect(typeof q.interrupt).toBe('function')
    expect(typeof q.setPermissionMode).toBe('function')
  })
})

describe('query(): запрос к Ollama', () => {
  it('шлёт POST /api/chat на OLLAMA_URL с моделью, num_ctx и текстом prompt', async () => {
    const fetchMock = mockOllama(() => jsonResponse(ollamaReply('ok')))

    await collect(query({ prompt: 'Привет' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const args = fetchMock.mock.calls[0]
    expect(requestUrl(args)).toBe(`${OLLAMA_URL}/api/chat`)
    expect(args[1]?.method).toBe('POST')
    const body = requestBody(args)
    expect(body.model).toBe('qwen3:14b')
    expect(body.stream).toBe(false)
    expect(body.options?.num_ctx).toBe(32768)
    expect(body.messages).toEqual([{ role: 'user', content: 'Привет' }])
  })

  it('options.model перекрывает OLLAMA_MODEL и попадает в system/init', async () => {
    const fetchMock = mockOllama(() => jsonResponse(ollamaReply('ok', { model: 'qwen3:8b' })))

    const [init] = await collect(query({ prompt: 'hi', options: { model: 'qwen3:8b' } }))

    expect(requestBody(fetchMock.mock.calls[0]).model).toBe('qwen3:8b')
    if (init.type !== 'system' || init.subtype !== 'init') throw new Error('нет system/init')
    expect(init.model).toBe('qwen3:8b')
  })

  it('options.systemPrompt строкой уходит первым сообщением с ролью system', async () => {
    const fetchMock = mockOllama(() => jsonResponse(ollamaReply('ok')))

    await collect(query({ prompt: 'hi', options: { systemPrompt: 'Отвечай кратко.' } }))

    expect(requestBody(fetchMock.mock.calls[0]).messages).toEqual([
      { role: 'system', content: 'Отвечай кратко.' },
      { role: 'user', content: 'hi' },
    ])
  })

  it('без OLLAMA_URL идёт на http://localhost:11434', async () => {
    vi.stubEnv('OLLAMA_URL', undefined)
    const fetchMock = mockOllama(() => jsonResponse(ollamaReply('ok')))

    await collect(query({ prompt: 'hi' }))

    expect(requestUrl(fetchMock.mock.calls[0])).toBe('http://localhost:11434/api/chat')
  })

  it('убирает завершающий слэш из OLLAMA_URL', async () => {
    vi.stubEnv('OLLAMA_URL', `${OLLAMA_URL}/`)
    const fetchMock = mockOllama(() => jsonResponse(ollamaReply('ok')))

    await collect(query({ prompt: 'hi' }))

    expect(requestUrl(fetchMock.mock.calls[0])).toBe(`${OLLAMA_URL}/api/chat`)
  })
})

describe('query(): prompt как AsyncIterable<SDKUserMessage>', () => {
  it('отправляет текст сообщения пользователя и возвращает ответ', async () => {
    const fetchMock = mockOllama(() => jsonResponse(ollamaReply('Берлин')))

    const messages = await collect(query({ prompt: userMessages('Столица Германии?') }))

    expect(requestBody(fetchMock.mock.calls[0]).messages).toEqual([
      { role: 'user', content: 'Столица Германии?' },
    ])
    const result = messages.at(-1)
    if (result?.type !== 'result' || result.subtype !== 'success') throw new Error('нет success')
    expect(result.result).toBe('Берлин')
  })

  it('принимает content массивом текстовых блоков', async () => {
    const fetchMock = mockOllama(() => jsonResponse(ollamaReply('ok')))

    async function* blocks(): AsyncIterable<SDKUserMessage> {
      yield {
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'Первая часть.' },
            { type: 'text', text: 'Вторая часть.' },
          ],
        },
        parent_tool_use_id: null,
        session_id: '',
      }
    }

    await collect(query({ prompt: blocks() }))

    expect(requestBody(fetchMock.mock.calls[0]).messages).toEqual([
      { role: 'user', content: 'Первая часть.\n\nВторая часть.' },
    ])
  })
})

describe('query(): ошибки Ollama', () => {
  it('недоступная Ollama даёт понятную ошибку с адресом', async () => {
    mockOllama(() => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      })
    })

    await expect(collect(query({ prompt: 'hi' }))).rejects.toThrow(
      `Ollama is unreachable at ${OLLAMA_URL}`,
    )
  })

  it('таймаут запроса даёт ошибку, а не зависание', async () => {
    vi.stubEnv('OLLAMA_TIMEOUT_MS', '50')
    mockOllama(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )

    await expect(collect(query({ prompt: 'hi' }))).rejects.toThrow(
      'Ollama request timed out after 50 ms',
    )
  }, 2000)

  it('HTTP-ошибка Ollama передаёт статус и текст ошибки', async () => {
    mockOllama(() => jsonResponse({ error: "model 'qwen9' not found" }, 404))

    await expect(collect(query({ prompt: 'hi' }))).rejects.toThrow(
      "Ollama responded with 404: model 'qwen9' not found",
    )
  })

  it('некорректное значение OLLAMA_NUM_CTX — ошибка конфигурации', async () => {
    vi.stubEnv('OLLAMA_NUM_CTX', 'много')
    const fetchMock = mockOllama(() => jsonResponse(ollamaReply('ok')))

    await expect(collect(query({ prompt: 'hi' }))).rejects.toThrow(/OLLAMA_NUM_CTX/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('некорректное значение OLLAMA_TIMEOUT_MS — ошибка конфигурации', async () => {
    vi.stubEnv('OLLAMA_TIMEOUT_MS', '-1')
    const fetchMock = mockOllama(() => jsonResponse(ollamaReply('ok')))

    await expect(collect(query({ prompt: 'hi' }))).rejects.toThrow(/OLLAMA_TIMEOUT_MS/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
