// Тесты фазы 3: отмена через `interrupt()` и `options.abortController`, смена режима прав
// `setPermissionMode()` во время сессии. Как в оригинале: `interrupt()` завершает генератор без
// ошибки, а отмена `abortController` — исключением `AbortError`.
import { z } from 'zod'
import { AbortError, createSdkMcpServer, query, tool } from './index.js'
import type { HookCallback, SDKUserMessage } from './index.js'
import {
  collect,
  hangingOllama,
  ollamaReply,
  requestSignal,
  scriptedOllama,
  stubOllamaEnv,
  toolCallReply,
} from './testing/ollama-mock.js'
import type { FetchArgs } from './testing/ollama-mock.js'

function noteServer(
  handler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] })),
) {
  const save = tool('save_note', 'Сохраняет заметку', { text: z.string() }, handler)
  return {
    server: createSdkMcpServer({ name: 'notes', version: '1.0.0', tools: [save] }),
    handler,
  }
}

/** Поток сообщений пользователя, которые отдаются по одному по запросу теста. */
function manualPrompt() {
  const queue: string[] = []
  let wake: (() => void) | undefined
  async function* stream(): AsyncIterable<SDKUserMessage> {
    while (true) {
      while (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve))
      const text = queue.shift() ?? ''
      if (text === '<end>') return
      yield {
        type: 'user',
        message: { role: 'user', content: text },
        parent_tool_use_id: null,
        session_id: '',
      }
    }
  }
  return {
    stream: stream(),
    send(text: string) {
      queue.push(text)
      wake?.()
    },
  }
}

beforeEach(() => {
  stubOllamaEnv()
})

describe('abortController', () => {
  it('abort() обрывает текущий запрос к Ollama, генератор бросает AbortError', async () => {
    const fetchMock = hangingOllama()
    const abortController = new AbortController()
    const q = query({ prompt: 'hi', options: { abortController } })

    const first = await q.next()
    expect(first.value?.type).toBe('system')
    const pending = q.next()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    abortController.abort()

    await expect(pending).rejects.toBeInstanceOf(AbortError)
    expect(requestSignal(fetchMock)?.aborted).toBe(true)
  }, 2000)

  it('AbortError — наследник Error с понятным текстом', async () => {
    hangingOllama()
    const abortController = new AbortController()
    const q = query({ prompt: 'hi', options: { abortController } })
    await q.next()
    const pending = q.next()
    abortController.abort()

    const error: unknown = await pending.catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/abort/i)
  }, 2000)

  it('abort() во время чтения тела HTTP-ошибки — AbortError, а не текст ошибки Ollama', async () => {
    const abortController = new AbortController()
    const fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>((_input, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          // Тело 500 читается, когда вызывающий отменяет сессию: как у настоящего fetch, чтение
          // отклоняется `signal.reason`.
          init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason))
          abortController.abort()
        },
      })
      return Promise.resolve(new Response(body, { status: 500 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      collect(query({ prompt: 'hi', options: { abortController } })),
    ).rejects.toBeInstanceOf(AbortError)
  }, 2000)

  it('уже отменённый abortController — запрос не уходит, AbortError', async () => {
    const fetchMock = scriptedOllama(ollamaReply('ok'))
    const abortController = new AbortController()
    abortController.abort()

    await expect(
      collect(query({ prompt: 'hi', options: { abortController } })),
    ).rejects.toBeInstanceOf(AbortError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('abort() во время инструмента — следующий запрос к модели не уходит', async () => {
    const abortController = new AbortController()
    const handler = vi.fn(async () => {
      abortController.abort()
      return { content: [{ type: 'text' as const, text: 'ok' }] }
    })
    const { server } = noteServer(handler)
    const fetchMock = scriptedOllama(
      toolCallReply({ name: 'mcp__notes__save_note', arguments: { text: 'a' } }),
      ollamaReply('Готово'),
    )

    await expect(
      collect(
        query({
          prompt: 'Сохрани',
          options: {
            abortController,
            mcpServers: { notes: server },
            allowedTools: ['mcp__notes__save_note'],
          },
        }),
      ),
    ).rejects.toBeInstanceOf(AbortError)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('abort() срабатывает signal в canUseTool, зависший canUseTool не держит сессию', async () => {
    const abortController = new AbortController()
    const signals: AbortSignal[] = []
    const { server, handler } = noteServer()
    scriptedOllama(toolCallReply({ name: 'mcp__notes__save_note', arguments: { text: 'a' } }))

    const run = collect(
      query({
        prompt: 'Сохрани',
        options: {
          abortController,
          mcpServers: { notes: server },
          canUseTool: (_name, _input, { signal }) => {
            signals.push(signal)
            abortController.abort()
            return new Promise(() => {})
          },
        },
      }),
    )

    await expect(run).rejects.toBeInstanceOf(AbortError)
    expect(signals).toHaveLength(1)
    expect(signals[0].aborted).toBe(true)
    expect(handler).not.toHaveBeenCalled()
  }, 2000)

  it('abort() завершает потоковую сессию, ждущую следующего сообщения', async () => {
    scriptedOllama(ollamaReply('ok'))
    const abortController = new AbortController()
    const prompt = manualPrompt()
    prompt.send('первое')
    const q = query({ prompt: prompt.stream, options: { abortController } })

    const types: string[] = []
    const run = (async () => {
      for await (const message of q) {
        types.push(message.type)
        if (message.type === 'result') abortController.abort()
      }
    })()

    await expect(run).rejects.toBeInstanceOf(AbortError)
    expect(types).toEqual(['system', 'assistant', 'result'])
  }, 2000)

  it('SessionEnd вызывается и после abort()', async () => {
    hangingOllama()
    const abortController = new AbortController()
    const sessionEnd = vi.fn<HookCallback>(async () => ({}))
    const q = query({
      prompt: 'hi',
      options: { abortController, hooks: { SessionEnd: [{ hooks: [sessionEnd] }] } },
    })
    await q.next()
    const pending = q.next()
    abortController.abort()

    await expect(pending).rejects.toBeInstanceOf(AbortError)
    expect(sessionEnd).toHaveBeenCalledTimes(1)
  }, 2000)

  it('interrupt() не отменяет abortController вызывающего кода', async () => {
    hangingOllama()
    const abortController = new AbortController()
    const q = query({ prompt: 'hi', options: { abortController } })
    await q.next()
    const pending = q.next()
    await q.interrupt()

    await expect(pending).resolves.toEqual({ done: true, value: undefined })
    expect(abortController.signal.aborted).toBe(false)
  }, 2000)
})

describe('interrupt()', () => {
  it('во время инструмента — следующий запрос к модели не уходит, result нет', async () => {
    const session: { q?: ReturnType<typeof query> } = {}
    const handler = vi.fn(async () => {
      await session.q?.interrupt()
      return { content: [{ type: 'text' as const, text: 'ok' }] }
    })
    const { server } = noteServer(handler)
    const fetchMock = scriptedOllama(
      toolCallReply({ name: 'mcp__notes__save_note', arguments: { text: 'a' } }),
      ollamaReply('Готово'),
    )
    session.q = query({
      prompt: 'Сохрани',
      options: { mcpServers: { notes: server }, allowedTools: ['mcp__notes__save_note'] },
    })

    const messages = await collect(session.q)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(messages.map((message) => message.type)).not.toContain('result')
  })
})

describe('setPermissionMode()', () => {
  it('меняет режим прав во время потоковой сессии', async () => {
    const { server, handler } = noteServer()
    scriptedOllama(
      toolCallReply({ name: 'mcp__notes__save_note', arguments: { text: 'a' } }),
      ollamaReply('Отказано'),
      toolCallReply({ name: 'mcp__notes__save_note', arguments: { text: 'b' } }),
      ollamaReply('Сохранено'),
    )
    const prompt = manualPrompt()
    prompt.send('первое')
    const q = query({ prompt: prompt.stream, options: { mcpServers: { notes: server } } })

    const results: { denials: number; subtype: string }[] = []
    for await (const message of q) {
      if (message.type !== 'result') continue
      results.push({ denials: message.permission_denials.length, subtype: message.subtype })
      if (results.length === 1) {
        // default без allowedTools и canUseTool — отказ; bypassPermissions — выполнение.
        await q.setPermissionMode('bypassPermissions')
        prompt.send('второе')
      } else {
        prompt.send('<end>')
      }
    }

    expect(results).toEqual([
      { denials: 1, subtype: 'success' },
      { denials: 0, subtype: 'success' },
    ])
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ text: 'b' }, expect.anything())
  })

  it('новый режим виден хукам в permission_mode', async () => {
    const modes: (string | undefined)[] = []
    const onPrompt = vi.fn<HookCallback>(async (input) => {
      modes.push(input.permission_mode)
      return {}
    })
    scriptedOllama(ollamaReply('ok'))
    const prompt = manualPrompt()
    prompt.send('первое')
    const q = query({
      prompt: prompt.stream,
      options: { hooks: { UserPromptSubmit: [{ hooks: [onPrompt] }] } },
    })

    let results = 0
    for await (const message of q) {
      if (message.type !== 'result') continue
      results += 1
      if (results === 1) {
        await q.setPermissionMode('plan')
        prompt.send('второе')
      } else {
        prompt.send('<end>')
      }
    }

    expect(modes).toEqual(['default', 'plan'])
  })

  it('plan посреди сессии блокирует инструмент даже из allowedTools', async () => {
    const { server, handler } = noteServer()
    scriptedOllama(
      toolCallReply({ name: 'mcp__notes__save_note', arguments: { text: 'a' } }),
      ollamaReply('Готово'),
    )
    const prompt = manualPrompt()
    const q = query({
      prompt: prompt.stream,
      options: { mcpServers: { notes: server }, allowedTools: ['mcp__notes__save_note'] },
    })
    await q.setPermissionMode('plan')
    prompt.send('первое')

    const messages: string[] = []
    for await (const message of q) {
      messages.push(message.type)
      if (message.type === 'result') prompt.send('<end>')
    }

    expect(handler).not.toHaveBeenCalled()
    expect(messages).toContain('result')
  })
})
