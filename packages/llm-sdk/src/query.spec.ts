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
  think?: boolean
  options?: { num_ctx?: number }
} {
  const [, init] = args
  return JSON.parse(init?.body as string) as ReturnType<typeof requestBody>
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

  it('выключает рассуждение Qwen3 (think: false): оно тратит время и контекст', async () => {
    const fetchMock = mockOllama(() => jsonResponse(ollamaReply('ok')))

    await collect(query({ prompt: 'Привет' }))

    expect(requestBody(fetchMock.mock.calls[0]).think).toBe(false)
  })

  it('tools: [] принимается, запрос уходит', async () => {
    const fetchMock = mockOllama(() => jsonResponse(ollamaReply('ok')))

    await collect(query({ prompt: 'hi', options: { tools: [] } }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('встроенные инструменты в tools — понятная ошибка до запроса', async () => {
    const fetchMock = mockOllama(() => jsonResponse(ollamaReply('ok')))

    await expect(collect(query({ prompt: 'hi', options: { tools: ['Bash'] } }))).rejects.toThrow(
      'Built-in tools are not supported',
    )
    expect(fetchMock).not.toHaveBeenCalled()
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

  it('HTTP-ошибка не выдаётся за таймаут, если тело дочитывается после него', async () => {
    vi.stubEnv('OLLAMA_TIMEOUT_MS', '50')
    mockOllama(() => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          setTimeout(() => {
            controller.enqueue(new TextEncoder().encode('{"error":"out of memory"}'))
            controller.close()
          }, 100)
        },
      })
      return new Response(body, { status: 500 })
    })

    await expect(collect(query({ prompt: 'hi' }))).rejects.toThrow(
      'Ollama responded with 500: out of memory',
    )
  }, 2000)

  it('HTTP-ошибка с телом не в JSON: статус в тексте, тело только в cause', async () => {
    mockOllama(() => new Response('<html>502 from proxy 10.0.0.5</html>', { status: 502 }))

    const error: unknown = await collect(query({ prompt: 'hi' })).catch((e: unknown) => e)

    if (!(error instanceof Error)) throw new Error('ожидалась ошибка')
    expect(error.message).toContain('Ollama responded with 502')
    expect(error.message).not.toContain('10.0.0.5')
    expect(String(error.cause)).toContain('10.0.0.5')
  })

  it('ответ 200 без message — понятная ошибка, а не TypeError', async () => {
    mockOllama(() => jsonResponse({ done: false }))

    await expect(collect(query({ prompt: 'hi' }))).rejects.toThrow(
      'Ollama returned an unexpected response',
    )
  })

  it('ответ 200 не в JSON — понятная ошибка, а не SyntaxError', async () => {
    mockOllama(() => new Response('<html>proxy error</html>', { status: 200 }))

    await expect(collect(query({ prompt: 'hi' }))).rejects.toThrow(
      'Ollama returned an unexpected response',
    )
  })

  it('сырое тело неожиданного ответа уходит в cause, а не в текст ошибки', async () => {
    mockOllama(() => new Response('<html>internal proxy 10.0.0.5</html>', { status: 200 }))

    const error: unknown = await collect(query({ prompt: 'hi' })).catch((e: unknown) => e)

    if (!(error instanceof Error)) throw new Error('ожидалась ошибка')
    expect(error.message).not.toContain('10.0.0.5')
    expect(String(error.cause)).toContain('10.0.0.5')
  })

  it('OLLAMA_URL с query или hash — ошибка конфигурации', async () => {
    vi.stubEnv('OLLAMA_URL', `${OLLAMA_URL}/?token=x`)
    const fetchMock = mockOllama(() => jsonResponse(ollamaReply('ok')))

    await expect(collect(query({ prompt: 'hi' }))).rejects.toThrow(
      'OLLAMA_URL must not contain a query or hash',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('некорректное значение OLLAMA_NUM_CTX — ошибка конфигурации', async () => {
    vi.stubEnv('OLLAMA_NUM_CTX', 'много')
    const fetchMock = mockOllama(() => jsonResponse(ollamaReply('ok')))

    await expect(collect(query({ prompt: 'hi' }))).rejects.toThrow(/OLLAMA_NUM_CTX/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('OLLAMA_URL без схемы — ошибка конфигурации, а не «unreachable»', async () => {
    vi.stubEnv('OLLAMA_URL', '192.168.100.204:11434')
    const fetchMock = mockOllama(() => jsonResponse(ollamaReply('ok')))

    await expect(collect(query({ prompt: 'hi' }))).rejects.toThrow(
      'OLLAMA_URL must be an http(s) URL',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('некорректное значение OLLAMA_TIMEOUT_MS — ошибка конфигурации', async () => {
    vi.stubEnv('OLLAMA_TIMEOUT_MS', '-1')
    const fetchMock = mockOllama(() => jsonResponse(ollamaReply('ok')))

    await expect(collect(query({ prompt: 'hi' }))).rejects.toThrow(/OLLAMA_TIMEOUT_MS/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('query(): рассуждение Qwen3', () => {
  it('отрезает <think>…</think> в начале ответа', async () => {
    mockOllama(() => jsonResponse(ollamaReply('<think>\nдумаю\n</think>\n\nПариж')))

    const result = (await collect(query({ prompt: 'hi' }))).at(-1)

    if (result?.type !== 'result' || result.subtype !== 'success') throw new Error('нет success')
    expect(result.result).toBe('Париж')
  })

  it('не выдаёт за ответ рассуждение, оборванное без </think>', async () => {
    mockOllama(() => jsonResponse(ollamaReply('<think>\nдолго думаю', { done_reason: 'length' })))

    const result = (await collect(query({ prompt: 'hi' }))).at(-1)

    if (result?.type !== 'result' || result.subtype !== 'success') throw new Error('нет success')
    expect(result.result).toBe('')
    expect(result.stop_reason).toBe('max_tokens')
  })
})

describe('query(): interrupt()', () => {
  it('обрывает запрос к Ollama, генератор завершается без ошибки', async () => {
    mockOllama(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    const q = query({ prompt: 'hi' })

    const first = await q.next()
    expect(first.value?.type).toBe('system')
    const pending = q.next()
    await q.interrupt()

    await expect(pending).resolves.toEqual({ done: true, value: undefined })
  })

  it('завершает потоковую сессию, ждущую следующего сообщения пользователя', async () => {
    mockOllama(() => jsonResponse(ollamaReply('ok')))
    async function* oneThenWait(): AsyncIterable<SDKUserMessage> {
      yield* userMessages('первое')
      await new Promise(() => {})
    }
    const q = query({ prompt: oneThenWait() })

    const types: string[] = []
    for await (const message of q) {
      types.push(message.type)
      if (message.type === 'result') await q.interrupt()
    }

    expect(types).toEqual(['system', 'assistant', 'result'])
  }, 2000)

  it('HTTP-ошибка не теряется, если interrupt() пришёл после ответа', async () => {
    const session: { q?: ReturnType<typeof query> } = {}
    mockOllama(async () => {
      await session.q?.interrupt()
      return jsonResponse({ error: 'boom' }, 500)
    })
    session.q = query({ prompt: 'hi' })

    await expect(collect(session.q)).rejects.toThrow('Ollama responded with 500: boom')
  })
})
