// Тесты фазы 4: сессии — `resume`, `continue`, `forkSession` и хранилище сессий (`sessionStore`).
// Транспорт Ollama подменяется мок-`fetch`, сеть не нужна.
import { z } from 'zod'
import { createSdkMcpServer, InMemorySessionStore, query, tool } from './index.js'
import type { HookInput, Options, SessionKey, SessionStore, SessionStoreEntry } from './index.js'
import {
  collect,
  hangingOllama,
  lastResult,
  ollamaReply,
  requests,
  scriptedOllama,
  stubOllamaEnv,
  toolCallReply,
} from './testing/ollama-mock.js'
import type { OllamaRequestBody } from './testing/ollama-mock.js'
import { DEFAULT_STORE_MAX_SESSIONS } from './sessions.js'

beforeEach(() => {
  stubOllamaEnv()
})

afterEach(() => {
  vi.useRealTimers()
})

/** Проводит одну сессию до конца и возвращает её id из `result`. */
async function runSession(prompt: string, options: Options = {}): Promise<string> {
  const messages = await collect(query({ prompt, options }))
  const result = lastResult(messages)
  expect(result.subtype).toBe('success')
  return result.session_id
}

/** Сообщения последнего запроса к Ollama без системного промпта: роль и текст. */
function dialog(body: OllamaRequestBody | undefined): string[] {
  return (body?.messages ?? [])
    .filter((message) => message.role !== 'system')
    .map((message) => `${message.role}: ${message.content}`)
}

describe('resume', () => {
  it('продолжает сессию с контекстом: модель получает прежние сообщения', async () => {
    const store = new InMemorySessionStore()
    scriptedOllama(ollamaReply('Запомнил: ЛИМОН-42'))
    const sessionId = await runSession('Запомни кодовое слово ЛИМОН-42', { sessionStore: store })

    const fetchMock = scriptedOllama(ollamaReply('ЛИМОН-42'))
    const messages = await collect(
      query({
        prompt: 'Какое кодовое слово?',
        options: { sessionStore: store, resume: sessionId },
      }),
    )

    expect(dialog(requests(fetchMock)[0])).toEqual([
      'user: Запомни кодовое слово ЛИМОН-42',
      'assistant: Запомнил: ЛИМОН-42',
      'user: Какое кодовое слово?',
    ])
    const result = lastResult(messages)
    expect(result.subtype).toBe('success')
    // Без forkSession сессия та же: id сохраняется во всех сообщениях.
    expect(messages.every((message) => message.session_id === sessionId)).toBe(true)
  })

  // Хранилище по умолчанию — в памяти процесса: unit-тесты не пишут файлы на диск разработчика.
  it('работает без sessionStore: хранилище по умолчанию', async () => {
    scriptedOllama(ollamaReply('Запомнил: ГРУША-7'))
    const sessionId = await runSession('Запомни кодовое слово ГРУША-7')

    const fetchMock = scriptedOllama(ollamaReply('ГРУША-7'))
    await collect(query({ prompt: 'Какое кодовое слово?', options: { resume: sessionId } }))

    expect(dialog(requests(fetchMock)[0])).toEqual([
      'user: Запомни кодовое слово ГРУША-7',
      'assistant: Запомнил: ГРУША-7',
      'user: Какое кодовое слово?',
    ])
  })

  it('восстанавливает вызовы инструментов и их результаты', async () => {
    const store = new InMemorySessionStore()
    const lookup = tool('lookup', 'Ищет значение', { key: z.string() }, async ({ key }) => ({
      content: [{ type: 'text', text: `значение ${key}` }],
    }))
    const server = createSdkMcpServer({ name: 'kv', tools: [lookup] })
    const options: Options = {
      sessionStore: store,
      mcpServers: { kv: server },
      allowedTools: ['mcp__kv__lookup'],
    }
    scriptedOllama(
      toolCallReply({ name: 'mcp__kv__lookup', arguments: { key: 'a' } }),
      ollamaReply('Готово'),
    )
    const sessionId = await runSession('Найди a', options)

    const fetchMock = scriptedOllama(ollamaReply('Ещё раз готово'))
    await collect(query({ prompt: 'Повтори', options: { ...options, resume: sessionId } }))

    const restored = requests(fetchMock)[0].messages.filter((message) => message.role !== 'system')
    expect(restored.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'user',
    ])
    expect(restored[1].tool_calls?.[0]?.function).toEqual({
      name: 'mcp__kv__lookup',
      arguments: { key: 'a' },
    })
    expect(restored[2]).toMatchObject({ content: 'значение a', tool_name: 'mcp__kv__lookup' })
  })

  it('системный промпт берётся из нового query() и не дублируется', async () => {
    const store = new InMemorySessionStore()
    scriptedOllama(ollamaReply('Первый'))
    const sessionId = await runSession('Привет', { sessionStore: store, systemPrompt: 'Промпт A' })

    const fetchMock = scriptedOllama(ollamaReply('Второй'))
    await collect(
      query({
        prompt: 'Ещё',
        options: { sessionStore: store, resume: sessionId, systemPrompt: 'Промпт B' },
      }),
    )

    const system = requests(fetchMock)[0].messages.filter((message) => message.role === 'system')
    expect(system).toEqual([{ role: 'system', content: 'Промпт B' }])
  })

  it('сообщения продолженной сессии сохраняются: следующий resume видит оба обмена', async () => {
    const store = new InMemorySessionStore()
    scriptedOllama(ollamaReply('Один'))
    const sessionId = await runSession('Первый вопрос', { sessionStore: store })
    scriptedOllama(ollamaReply('Два'))
    await runSession('Второй вопрос', { sessionStore: store, resume: sessionId })

    const fetchMock = scriptedOllama(ollamaReply('Три'))
    await collect(
      query({ prompt: 'Третий вопрос', options: { sessionStore: store, resume: sessionId } }),
    )

    expect(dialog(requests(fetchMock)[0])).toEqual([
      'user: Первый вопрос',
      'assistant: Один',
      'user: Второй вопрос',
      'assistant: Два',
      'user: Третий вопрос',
    ])
  })

  it('хук SessionStart получает source: resume', async () => {
    const store = new InMemorySessionStore()
    scriptedOllama(ollamaReply('Ок'))
    const sessionId = await runSession('Привет', { sessionStore: store })
    const inputs: HookInput[] = []

    await collect(
      query({
        prompt: 'Снова',
        options: {
          sessionStore: store,
          resume: sessionId,
          hooks: {
            SessionStart: [
              {
                hooks: [
                  async (input) => {
                    inputs.push(input)
                    return {}
                  },
                ],
              },
            ],
          },
        },
      }),
    )

    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toMatchObject({
      hook_event_name: 'SessionStart',
      source: 'resume',
      session_id: sessionId,
    })
  })

  it('неизвестный id сессии — ошибка с этим id, запрос к модели не уходит', async () => {
    const fetchMock = scriptedOllama(ollamaReply('Не должно быть'))
    const missing = '00000000-0000-4000-8000-000000000000'

    await expect(
      collect(
        query({
          prompt: 'Привет',
          options: { sessionStore: new InMemorySessionStore(), resume: missing },
        }),
      ),
    ).rejects.toThrow(missing)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('continue', () => {
  it('берёт последнюю сессию', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const store = new InMemorySessionStore()
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'))
    scriptedOllama(ollamaReply('Старый ответ'))
    await runSession('Старая сессия', { sessionStore: store })
    vi.setSystemTime(new Date('2026-11-15T11:00:00Z'))
    scriptedOllama(ollamaReply('Новый ответ'))
    const latest = await runSession('Новая сессия', { sessionStore: store })

    vi.setSystemTime(new Date('2026-11-15T12:00:00Z'))
    const fetchMock = scriptedOllama(ollamaReply('Продолжаю'))
    const messages = await collect(
      query({ prompt: 'Продолжим', options: { sessionStore: store, continue: true } }),
    )

    expect(dialog(requests(fetchMock)[0])).toEqual([
      'user: Новая сессия',
      'assistant: Новый ответ',
      'user: Продолжим',
    ])
    expect(lastResult(messages).session_id).toBe(latest)
  })

  it('последней становится сессия, которую продолжили через resume', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const store = new InMemorySessionStore()
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'))
    scriptedOllama(ollamaReply('Ответ A'))
    const first = await runSession('Сессия A', { sessionStore: store })
    vi.setSystemTime(new Date('2026-11-15T11:00:00Z'))
    scriptedOllama(ollamaReply('Ответ B'))
    await runSession('Сессия B', { sessionStore: store })
    vi.setSystemTime(new Date('2026-11-15T12:00:00Z'))
    scriptedOllama(ollamaReply('Ещё A'))
    await runSession('Снова A', { sessionStore: store, resume: first })

    vi.setSystemTime(new Date('2026-11-15T13:00:00Z'))
    const fetchMock = scriptedOllama(ollamaReply('Продолжаю'))
    const messages = await collect(
      query({ prompt: 'Продолжим', options: { sessionStore: store, continue: true } }),
    )

    expect(dialog(requests(fetchMock)[0])[0]).toBe('user: Сессия A')
    expect(lastResult(messages).session_id).toBe(first)
  })

  it('без сохранённых сессий начинает новую', async () => {
    const fetchMock = scriptedOllama(ollamaReply('Привет'))

    const messages = await collect(
      query({
        prompt: 'Начнём',
        options: { sessionStore: new InMemorySessionStore(), continue: true },
      }),
    )

    expect(dialog(requests(fetchMock)[0])).toEqual(['user: Начнём'])
    expect(lastResult(messages).subtype).toBe('success')
  })
})

describe('forkSession', () => {
  it('создаёт новую сессию с историей исходной', async () => {
    const store = new InMemorySessionStore()
    scriptedOllama(ollamaReply('Запомнил'))
    const original = await runSession('Запомни ЛИМОН-42', { sessionStore: store })

    const fetchMock = scriptedOllama(ollamaReply('ЛИМОН-42'))
    const messages = await collect(
      query({
        prompt: 'Какое слово?',
        options: { sessionStore: store, resume: original, forkSession: true },
      }),
    )

    const forked = lastResult(messages).session_id
    expect(forked).not.toBe(original)
    expect(messages.every((message) => message.session_id === forked)).toBe(true)
    expect(dialog(requests(fetchMock)[0])).toEqual([
      'user: Запомни ЛИМОН-42',
      'assistant: Запомнил',
      'user: Какое слово?',
    ])
  })

  it('не меняет исходную сессию', async () => {
    const store = new InMemorySessionStore()
    scriptedOllama(ollamaReply('Запомнил'))
    const original = await runSession('Запомни ЛИМОН-42', { sessionStore: store })
    scriptedOllama(ollamaReply('Теперь ГРУША-7'))
    await runSession('Слово теперь ГРУША-7', {
      sessionStore: store,
      resume: original,
      forkSession: true,
    })

    const fetchMock = scriptedOllama(ollamaReply('ЛИМОН-42'))
    await collect(
      query({ prompt: 'Какое слово?', options: { sessionStore: store, resume: original } }),
    )

    expect(dialog(requests(fetchMock)[0])).toEqual([
      'user: Запомни ЛИМОН-42',
      'assistant: Запомнил',
      'user: Какое слово?',
    ])
  })

  it('ответвлённую сессию можно продолжить по её id', async () => {
    const store = new InMemorySessionStore()
    scriptedOllama(ollamaReply('Запомнил'))
    const original = await runSession('Запомни ЛИМОН-42', { sessionStore: store })
    scriptedOllama(ollamaReply('Теперь ГРУША-7'))
    const forked = await runSession('Слово теперь ГРУША-7', {
      sessionStore: store,
      resume: original,
      forkSession: true,
    })

    const fetchMock = scriptedOllama(ollamaReply('ГРУША-7'))
    await collect(
      query({ prompt: 'Какое слово?', options: { sessionStore: store, resume: forked } }),
    )

    expect(dialog(requests(fetchMock)[0])).toEqual([
      'user: Запомни ЛИМОН-42',
      'assistant: Запомнил',
      'user: Слово теперь ГРУША-7',
      'assistant: Теперь ГРУША-7',
      'user: Какое слово?',
    ])
  })
})

describe('sessionStore', () => {
  /** Хранилище на Map: проверяет, что SDK работает только через интерфейс `SessionStore`. */
  function mapStore() {
    const data = new Map<string, { key: SessionKey; entries: SessionStoreEntry[]; mtime: number }>()
    const id = (key: SessionKey) => `${key.projectKey}/${key.sessionId}/${key.subpath ?? ''}`
    const store = {
      append: vi.fn(async (key: SessionKey, entries: SessionStoreEntry[]) => {
        const existing = data.get(id(key))
        // Хранилище обязано вернуть то же, что получило: записи сериализуются, как в БД.
        const copy = JSON.parse(JSON.stringify(entries)) as SessionStoreEntry[]
        data.set(id(key), {
          key,
          entries: [...(existing?.entries ?? []), ...copy],
          mtime: Date.now(),
        })
      }),
      // Копия, как из БД: правка загруженных записей не должна менять хранилище.
      load: vi.fn(async (key: SessionKey) => structuredClone(data.get(id(key))?.entries ?? null)),
      listSessions: vi.fn(async (projectKey: string) =>
        [...data.values()]
          .filter((item) => item.key.projectKey === projectKey && !item.key.subpath)
          .map((item) => ({ sessionId: item.key.sessionId, mtime: item.mtime })),
      ),
    } satisfies SessionStore
    return store
  }

  it('сессия пишется в переданное хранилище под своим id', async () => {
    const store = mapStore()
    scriptedOllama(ollamaReply('Ок'))

    const sessionId = await runSession('Привет', { sessionStore: store })

    expect(store.append).toHaveBeenCalled()
    for (const [key, entries] of store.append.mock.calls) {
      expect(key.sessionId).toBe(sessionId)
      expect(typeof key.projectKey).toBe('string')
      for (const entry of entries) expect(typeof entry.type).toBe('string')
    }
  })

  it('resume читает историю через load()', async () => {
    const store = mapStore()
    scriptedOllama(ollamaReply('Запомнил'))
    const sessionId = await runSession('Запомни ЛИМОН-42', { sessionStore: store })

    const fetchMock = scriptedOllama(ollamaReply('ЛИМОН-42'))
    await collect(
      query({ prompt: 'Какое слово?', options: { sessionStore: store, resume: sessionId } }),
    )

    expect(store.load).toHaveBeenCalledWith(expect.objectContaining({ sessionId }))
    expect(dialog(requests(fetchMock)[0])).toEqual([
      'user: Запомни ЛИМОН-42',
      'assistant: Запомнил',
      'user: Какое слово?',
    ])
  })

  it('continue ищет последнюю сессию через listSessions()', async () => {
    const store = mapStore()
    scriptedOllama(ollamaReply('Ответ'))
    const sessionId = await runSession('Вопрос', { sessionStore: store })

    const fetchMock = scriptedOllama(ollamaReply('Дальше'))
    const messages = await collect(
      query({ prompt: 'Продолжим', options: { sessionStore: store, continue: true } }),
    )

    expect(store.listSessions).toHaveBeenCalled()
    expect(dialog(requests(fetchMock)[0])[0]).toBe('user: Вопрос')
    expect(lastResult(messages).session_id).toBe(sessionId)
  })

  it('ход сохраняется до result: break на result не теряет его', async () => {
    const store = new InMemorySessionStore()
    scriptedOllama(ollamaReply('Запомнил'))
    let sessionId = ''
    for await (const message of query({
      prompt: 'Запомни ЛИМОН-42',
      options: { sessionStore: store },
    })) {
      if (message.type === 'result') {
        sessionId = message.session_id
        break
      }
    }

    const fetchMock = scriptedOllama(ollamaReply('ЛИМОН-42'))
    await collect(
      query({ prompt: 'Какое слово?', options: { sessionStore: store, resume: sessionId } }),
    )

    expect(dialog(requests(fetchMock)[0])).toEqual([
      'user: Запомни ЛИМОН-42',
      'assistant: Запомнил',
      'user: Какое слово?',
    ])
  })

  it('прерванный ход и ответвление без ходов не пишутся', async () => {
    const store = mapStore()
    scriptedOllama(ollamaReply('Ок'))
    const sessionId = await runSession('Привет', { sessionStore: store })
    const appends = store.append.mock.calls.length

    hangingOllama()
    const q = query({ prompt: 'Снова', options: { sessionStore: store, resume: sessionId } })
    await q.next()
    const rest = collect(q)
    await q.interrupt()
    await rest
    for await (const message of query({
      prompt: 'Ещё',
      options: { sessionStore: store, resume: sessionId, forkSession: true },
    })) {
      if (message.type === 'system') break
    }

    expect(store.append.mock.calls.length).toBe(appends)
  })

  it('хранилище по умолчанию вытесняет старые сессии', async () => {
    scriptedOllama(
      ...Array.from({ length: DEFAULT_STORE_MAX_SESSIONS + 1 }, () => ollamaReply('Ок')),
    )
    const first = await runSession('Первая')
    let last = first
    for (let index = 0; index < DEFAULT_STORE_MAX_SESSIONS; index += 1) {
      last = await runSession(`Сессия ${index}`)
    }

    await expect(collect(query({ prompt: 'Снова', options: { resume: first } }))).rejects.toThrow(
      first,
    )
    scriptedOllama(ollamaReply('Ок'))
    await expect(runSession('Снова', { resume: last })).resolves.toBe(last)
  })

  it('сессии разных хранилищ не видны друг другу', async () => {
    scriptedOllama(ollamaReply('Ок'))
    const sessionId = await runSession('Привет', { sessionStore: new InMemorySessionStore() })

    await expect(
      collect(
        query({
          prompt: 'Снова',
          options: { sessionStore: new InMemorySessionStore(), resume: sessionId },
        }),
      ),
    ).rejects.toThrow(sessionId)
  })
})
