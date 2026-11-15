// Тесты фазы 3: `includePartialMessages` → `stream_event` из потокового ответа Ollama (NDJSON).
// События повторяют Messages API: message_start, content_block_start/delta/stop, message_delta,
// message_stop. Полное сообщение `assistant` идёт следом, как в оригинале.
import { z } from 'zod'
import { AbortError, createSdkMcpServer, query, tool } from './index.js'
import type { SDKMessage } from './index.js'
import {
  collect,
  hangingStreamResponse,
  lastResult,
  ndjsonResponse,
  ollamaReply,
  requests,
  scriptedOllama,
  streamChunk,
  streamDone,
  stubOllamaEnv,
} from './testing/ollama-mock.js'
import type { FetchArgs } from './testing/ollama-mock.js'

/** Поля событий Messages API, которые проверяют тесты (без индексной сигнатуры: тип события
 * SDK должен быть присваиваем этой форме без приведений). */
interface StreamEventView {
  type: string
  index?: number
  message?: unknown
  content_block?: unknown
  delta?: unknown
  usage?: unknown
}

/** События `stream_event` по порядку: сужение по `message.type`, как в коде фич. */
function streamEvents(messages: SDKMessage[]): StreamEventView[] {
  const events: StreamEventView[] = []
  for (const message of messages) {
    if (message.type === 'stream_event') events.push(message.event)
  }
  return events
}

function textDeltas(messages: SDKMessage[]): string[] {
  const texts: string[] = []
  for (const message of messages) {
    if (message.type !== 'stream_event') continue
    const event = message.event
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      texts.push(event.delta.text)
    }
  }
  return texts
}

beforeEach(() => {
  stubOllamaEnv()
})

describe('includePartialMessages: stream_event', () => {
  it('запрос уходит со stream: true', async () => {
    const fetchMock = scriptedOllama(ndjsonResponse([streamChunk('Привет'), streamDone()]))

    await collect(query({ prompt: 'hi', options: { includePartialMessages: true } }))

    expect(requests(fetchMock)[0].stream).toBe(true)
  })

  it('без includePartialMessages — stream: false и ни одного stream_event', async () => {
    const fetchMock = scriptedOllama(ollamaReply('Привет'))

    const messages = await collect(query({ prompt: 'hi' }))

    expect(requests(fetchMock)[0].stream).toBe(false)
    expect(messages.map((message) => message.type)).toEqual(['system', 'assistant', 'result'])
  })

  it('чанки текста — content_block_delta с text_delta, затем полное assistant и result', async () => {
    scriptedOllama(
      ndjsonResponse([streamChunk('При'), streamChunk('вет, '), streamChunk('мир'), streamDone()]),
    )

    const messages = await collect(
      query({ prompt: 'hi', options: { includePartialMessages: true } }),
    )

    const events = streamEvents(messages)
    expect(events.map((event) => event.type)).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ])
    expect(textDeltas(messages)).toEqual(['При', 'вет, ', 'мир'])
    expect(events[1]).toMatchObject({
      index: 0,
      content_block: { type: 'text', text: '' },
    })

    const types = messages.map((message) => message.type)
    // Все stream_event идут до полного сообщения assistant.
    expect(types.lastIndexOf('stream_event')).toBeLessThan(types.indexOf('assistant'))
    expect(types.slice(-2)).toEqual(['assistant', 'result'])

    const assistant = messages.find((message) => message.type === 'assistant')
    if (assistant?.type !== 'assistant') throw new Error('нет assistant')
    expect(assistant.message.content).toEqual([{ type: 'text', text: 'Привет, мир' }])
    const result = lastResult(messages)
    if (result.subtype !== 'success') throw new Error(`получен ${result.subtype}`)
    expect(result.result).toBe('Привет, мир')
  })

  it('message_start несёт id и модель полного сообщения, message_delta — stop_reason и usage', async () => {
    scriptedOllama(
      ndjsonResponse([streamChunk('ok'), streamDone({ eval_count: 3, prompt_eval_count: 11 })]),
    )

    const messages = await collect(
      query({ prompt: 'hi', options: { includePartialMessages: true } }),
    )

    const events = streamEvents(messages)
    const assistant = messages.find((message) => message.type === 'assistant')
    if (assistant?.type !== 'assistant') throw new Error('нет assistant')
    expect(events[0]).toMatchObject({
      type: 'message_start',
      message: { id: assistant.message.id, role: 'assistant', model: 'qwen3:14b', content: [] },
    })
    const delta = events.find((event) => event.type === 'message_delta')
    expect(delta).toMatchObject({
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 3 },
    })
    expect(assistant.message.usage).toMatchObject({ input_tokens: 11, output_tokens: 3 })
  })

  it('stream_event несёт session_id сессии, uuid и parent_tool_use_id: null', async () => {
    scriptedOllama(ndjsonResponse([streamChunk('ok'), streamDone()]))

    const messages = await collect(
      query({ prompt: 'hi', options: { includePartialMessages: true } }),
    )

    const init = messages[0]
    if (init.type !== 'system') throw new Error('нет system/init')
    const partial = messages.filter((message) => message.type === 'stream_event')
    expect(partial.length).toBeGreaterThan(0)
    for (const message of partial) {
      expect(message).toMatchObject({
        session_id: init.session_id,
        parent_tool_use_id: null,
        uuid: expect.any(String) as unknown,
      })
    }
  })

  it('done_reason length — stop_reason max_tokens в message_delta и в assistant', async () => {
    scriptedOllama(ndjsonResponse([streamChunk('обрыв'), streamDone({ done_reason: 'length' })]))

    const messages = await collect(
      query({ prompt: 'hi', options: { includePartialMessages: true } }),
    )

    const delta = streamEvents(messages).find((event) => event.type === 'message_delta')
    expect(delta).toMatchObject({ delta: { stop_reason: 'max_tokens' } })
    const assistant = messages.find((message) => message.type === 'assistant')
    if (assistant?.type !== 'assistant') throw new Error('нет assistant')
    expect(assistant.message.stop_reason).toBe('max_tokens')
  })

  it('рассуждение <think> не попадает ни в text_delta, ни в assistant', async () => {
    scriptedOllama(
      ndjsonResponse([
        streamChunk('<think>'),
        streamChunk('размышляю'),
        streamChunk('</think>\n'),
        streamChunk('Ответ'),
        streamDone(),
      ]),
    )

    const messages = await collect(
      query({ prompt: 'hi', options: { includePartialMessages: true } }),
    )

    expect(textDeltas(messages).join('')).toBe('Ответ')
    const result = lastResult(messages)
    if (result.subtype !== 'success') throw new Error(`получен ${result.subtype}`)
    expect(result.result).toBe('Ответ')
  })
})

describe('includePartialMessages с инструментами', () => {
  it('вызов инструмента в потоке — content_block tool_use с input_json_delta, инструмент выполняется', async () => {
    const handler = vi.fn(async ({ text }: { text: string }) => ({
      content: [{ type: 'text' as const, text: `эхо: ${text}` }],
    }))
    const echo = tool('echo', 'Повторяет текст', { text: z.string() }, handler)
    const server = createSdkMcpServer({ name: 'util', version: '1.0.0', tools: [echo] })
    scriptedOllama(
      ndjsonResponse([
        streamChunk('', {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ function: { name: 'mcp__util__echo', arguments: { text: 'hi' } } }],
          },
        }),
        streamDone(),
      ]),
      ndjsonResponse([streamChunk('Готово'), streamDone()]),
    )

    const messages = await collect(
      query({
        prompt: 'Повтори hi',
        options: {
          includePartialMessages: true,
          mcpServers: { util: server },
          allowedTools: ['mcp__util__echo'],
        },
      }),
    )

    expect(handler).toHaveBeenCalledWith({ text: 'hi' }, expect.anything())
    const events = streamEvents(messages)
    const start = events.find(
      (event) =>
        event.type === 'content_block_start' &&
        (event.content_block as { type?: string } | undefined)?.type === 'tool_use',
    )
    const assistant = messages.find((message) => message.type === 'assistant')
    if (assistant?.type !== 'assistant') throw new Error('нет assistant')
    const toolUse = assistant.message.content.find((block) => block.type === 'tool_use')
    if (toolUse?.type !== 'tool_use') throw new Error('нет tool_use')
    expect(start).toMatchObject({
      content_block: { type: 'tool_use', id: toolUse.id, name: 'mcp__util__echo' },
    })
    const jsonDelta = events.find(
      (event) =>
        event.type === 'content_block_delta' &&
        (event.delta as { type?: string } | undefined)?.type === 'input_json_delta',
    )
    expect(jsonDelta?.index).toBe(start?.index)
    const partialJson = (jsonDelta?.delta as { partial_json?: string } | undefined)?.partial_json
    expect(JSON.parse(partialJson ?? '')).toEqual({ text: 'hi' })
    expect(events.filter((event) => event.type === 'message_delta')[0]).toMatchObject({
      delta: { stop_reason: 'tool_use' },
    })
    // Два запроса — два набора событий: message_start на каждый.
    expect(events.filter((event) => event.type === 'message_start')).toHaveLength(2)
    expect(lastResult(messages).subtype).toBe('success')
  })
})

describe('includePartialMessages: ошибки потока', () => {
  it('строка потока не в JSON — понятная ошибка', async () => {
    const encoder = new TextEncoder()
    const broken = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`${JSON.stringify(streamChunk('При'))}\n<html>\n`))
          controller.close()
        },
      }),
      { status: 200 },
    )
    scriptedOllama(broken)

    await expect(
      collect(query({ prompt: 'hi', options: { includePartialMessages: true } })),
    ).rejects.toThrow('Ollama returned an unexpected response')
  })

  it('чанк с полем error посреди потока — ошибка с текстом Ollama', async () => {
    scriptedOllama(ndjsonResponse([streamChunk('При'), { error: 'model runner crashed' }]))

    await expect(
      collect(query({ prompt: 'hi', options: { includePartialMessages: true } })),
    ).rejects.toThrow('model runner crashed')
  })

  it('поток оборвался без done — ошибка, а не обрезанный ответ под видом success', async () => {
    scriptedOllama(ndjsonResponse([streamChunk('При'), streamChunk('вет')]))

    await expect(
      collect(query({ prompt: 'hi', options: { includePartialMessages: true } })),
    ).rejects.toThrow(/Ollama/)
  })

  it('соединение оборвалось посреди тела — «stream was interrupted», а не «unreachable»', async () => {
    const encoder = new TextEncoder()
    const broken = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`${JSON.stringify(streamChunk('При'))}\n`))
          // Так undici сообщает о разрыве соединения во время чтения тела.
          controller.error(new TypeError('terminated'))
        },
      }),
      { status: 200 },
    )
    scriptedOllama(broken)

    const run = collect(query({ prompt: 'hi', options: { includePartialMessages: true } }))

    await expect(run).rejects.toThrow('Ollama stream was interrupted')
    await expect(run).rejects.not.toThrow(/unreachable/)
  })

  it('чанк, разрезанный между кусками тела, собирается целиком', async () => {
    const encoder = new TextEncoder()
    const line = `${JSON.stringify(streamChunk('Привет'))}\n${JSON.stringify(streamDone())}\n`
    const middle = Math.floor(line.length / 3)
    const split = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(line.slice(0, middle)))
          controller.enqueue(encoder.encode(line.slice(middle)))
          controller.close()
        },
      }),
      { status: 200 },
    )
    scriptedOllama(split)

    const messages = await collect(
      query({ prompt: 'hi', options: { includePartialMessages: true } }),
    )

    const result = lastResult(messages)
    if (result.subtype !== 'success') throw new Error(`получен ${result.subtype}`)
    expect(result.result).toBe('Привет')
  })

  it('interrupt() посреди потока — чтение обрывается, генератор завершается без ошибки', async () => {
    const fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>((_input, init) =>
      Promise.resolve(hangingStreamResponse([streamChunk('При')], init?.signal)),
    )
    vi.stubGlobal('fetch', fetchMock)
    const q = query({ prompt: 'hi', options: { includePartialMessages: true } })

    const types: string[] = []
    for await (const message of q) {
      types.push(message.type)
      if (message.type === 'stream_event' && message.event.type === 'content_block_delta') {
        await q.interrupt()
      }
    }

    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(types).not.toContain('assistant')
    expect(types).not.toContain('result')
  }, 2000)

  it('abortController.abort() посреди потока — AbortError, а не ошибка разбора потока', async () => {
    const fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>((_input, init) =>
      Promise.resolve(hangingStreamResponse([streamChunk('При')], init?.signal)),
    )
    vi.stubGlobal('fetch', fetchMock)
    const abortController = new AbortController()
    const q = query({ prompt: 'hi', options: { includePartialMessages: true, abortController } })

    const run = (async () => {
      for await (const message of q) {
        if (message.type === 'stream_event' && message.event.type === 'content_block_delta') {
          abortController.abort()
        }
      }
    })()

    await expect(run).rejects.toBeInstanceOf(AbortError)
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
  }, 2000)
})

describe('includePartialMessages вместе с outputFormat', () => {
  const schema = {
    type: 'object',
    properties: { answer: { type: 'string' } },
    required: ['answer'],
    additionalProperties: false,
  }

  it('повтор после ответа не по схеме тоже идёт потоком и с format', async () => {
    const fetchMock = scriptedOllama(
      ndjsonResponse([streamChunk('не '), streamChunk('JSON'), streamDone()]),
      ndjsonResponse([streamChunk('{"answer":'), streamChunk('"ok"}'), streamDone()]),
    )

    const messages = await collect(
      query({
        prompt: 'hi',
        options: {
          includePartialMessages: true,
          outputFormat: { type: 'json_schema', schema },
        },
      }),
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const body of requests(fetchMock)) {
      expect(body.stream).toBe(true)
      expect(body.format).toEqual(schema)
    }
    expect(streamEvents(messages).filter((event) => event.type === 'message_start')).toHaveLength(2)
    const result = lastResult(messages)
    if (result.subtype !== 'success') throw new Error(`получен ${result.subtype}`)
    expect(result.structured_output).toEqual({ answer: 'ok' })
  })
})
