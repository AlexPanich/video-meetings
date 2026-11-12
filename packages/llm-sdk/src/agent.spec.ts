// Тесты фазы 2: SDK-инструменты, агентный цикл, права, хуки и контроль размера контекста.
// Транспорт Ollama подменяется мок-`fetch`, сеть не нужна.
import { z } from 'zod'
import { createSdkMcpServer, query, tool } from './index.js'
import type { MockInstance } from 'vitest'
import type { Options, SDKMessage, SDKUserMessage } from './index.js'

const OLLAMA_URL = 'http://ollama.test:11434'

type FetchArgs = [input: string | URL | Request, init?: RequestInit]

interface OllamaRequestMessage {
  role: string
  content: string
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[]
  tool_name?: string
}

interface OllamaRequestBody {
  model: string
  messages: OllamaRequestMessage[]
  tools?: {
    type: string
    function: { name: string; description: string; parameters: Record<string, unknown> }
  }[]
  options?: { num_ctx?: number }
}

interface ToolCall {
  name: string
  arguments: Record<string, unknown>
}

/** Ответ Ollama `POST /api/chat` без стриминга. */
function ollamaReply(content: string, overrides: Record<string, unknown> = {}) {
  return {
    model: 'qwen3:14b',
    created_at: '2026-11-12T10:00:00Z',
    message: { role: 'assistant', content },
    done: true,
    done_reason: 'stop',
    prompt_eval_count: 21,
    eval_count: 7,
    ...overrides,
  }
}

/** Ответ Ollama с вызовами инструментов (`message.tool_calls`). */
function toolCallReply(...calls: ToolCall[]) {
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Мок Ollama, который отвечает по сценарию: i-й запрос получает i-й ответ, после конца
 * сценария повторяется последний.
 */
function scriptedOllama(...replies: unknown[]) {
  let index = 0
  const fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>(() => {
    const reply = replies[Math.min(index, replies.length - 1)]
    index += 1
    return Promise.resolve(jsonResponse(reply))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function requestBody(args: FetchArgs): OllamaRequestBody {
  const [, init] = args
  return JSON.parse(init?.body as string) as OllamaRequestBody
}

function requests(fetchMock: ReturnType<typeof scriptedOllama>): OllamaRequestBody[] {
  return fetchMock.mock.calls.map((args) => requestBody(args))
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Текст контента `tool_result`: строка или массив блоков `text`. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  const items: unknown[] = Array.isArray(content) ? content : []
  return items
    .map((block) => (isRecord(block) && typeof block.text === 'string' ? block.text : ''))
    .join('')
}

interface ToolUseView {
  id: string
  name: string
  input: unknown
}

interface ToolResultView {
  toolUseId: string
  isError: boolean
  text: string
}

/** Блоки `tool_use` из сообщений `assistant`. */
function toolUses(messages: SDKMessage[]): ToolUseView[] {
  const views: ToolUseView[] = []
  for (const message of messages) {
    if (message.type !== 'assistant') continue
    const blocks: unknown[] = message.message.content
    for (const block of blocks) {
      if (isRecord(block) && block.type === 'tool_use') {
        views.push({ id: String(block.id), name: String(block.name), input: block.input })
      }
    }
  }
  return views
}

/** Блоки `tool_result` из сообщений `user`. */
function toolResults(messages: SDKMessage[]): ToolResultView[] {
  const views: ToolResultView[] = []
  for (const message of messages) {
    if (message.type !== 'user') continue
    const content: unknown = message.message.content
    const blocks: unknown[] = Array.isArray(content) ? content : []
    for (const block of blocks) {
      if (isRecord(block) && block.type === 'tool_result') {
        views.push({
          toolUseId: String(block.tool_use_id),
          isError: block.is_error === true,
          text: contentText(block.content),
        })
      }
    }
  }
  return views
}

function lastResult(messages: SDKMessage[]) {
  const result = messages.at(-1)
  if (result?.type !== 'result') throw new Error('последнее сообщение — не result')
  return result
}

function initMessage(messages: SDKMessage[]) {
  const init = messages[0]
  if (init?.type !== 'system' || init.subtype !== 'init') throw new Error('нет system/init')
  return init
}

/** Сервер `calc` с `add` и `mul`; обработчики — шпионы. */
function calcServer() {
  const addHandler = vi.fn(async ({ a, b }: { a: number; b: number }) => ({
    content: [{ type: 'text' as const, text: String(a + b) }],
  }))
  const mulHandler = vi.fn(async ({ a, b }: { a: number; b: number }) => ({
    content: [{ type: 'text' as const, text: String(a * b) }],
  }))
  const add = tool('add', 'Складывает два числа', { a: z.number(), b: z.number() }, addHandler)
  const mul = tool('mul', 'Умножает два числа', { a: z.number(), b: z.number() }, mulHandler)
  const server = createSdkMcpServer({ name: 'calc', version: '1.0.0', tools: [add, mul] })
  return { server, addHandler, mulHandler }
}

const ADD = 'mcp__calc__add'
const MUL = 'mcp__calc__mul'

beforeEach(() => {
  vi.stubEnv('OLLAMA_URL', OLLAMA_URL)
  vi.stubEnv('OLLAMA_MODEL', 'qwen3:14b')
  vi.stubEnv('OLLAMA_NUM_CTX', '32768')
  vi.stubEnv('OLLAMA_TIMEOUT_MS', '5000')
})

describe('tool() и createSdkMcpServer()', () => {
  it('tool() возвращает определение с именем, описанием, схемой и обработчиком', () => {
    const handler = async () => ({ content: [{ type: 'text' as const, text: 'ok' }] })
    const shape = { a: z.number() }

    const definition = tool('add', 'Складывает', shape, handler)

    expect(definition.name).toBe('add')
    expect(definition.description).toBe('Складывает')
    expect(definition.inputSchema).toBe(shape)
    expect(definition.handler).toBe(handler)
  })

  it('createSdkMcpServer() возвращает конфиг SDK-сервера с именем', () => {
    const { server } = calcServer()

    expect(server.type).toBe('sdk')
    expect(server.name).toBe('calc')
  })

  it('system/init перечисляет инструменты как mcp__<server>__<tool> и SDK-серверы', async () => {
    scriptedOllama(ollamaReply('ok'))
    const { server } = calcServer()

    const init = initMessage(
      await collect(query({ prompt: 'hi', options: { tools: [], mcpServers: { calc: server } } })),
    )

    expect(init.tools).toEqual(expect.arrayContaining([ADD, MUL]))
    expect(init.mcp_servers).toEqual([{ name: 'calc', status: 'connected' }])
  })

  it('передаёт инструменты в Ollama как function tools с JSON Schema из zod', async () => {
    const fetchMock = scriptedOllama(ollamaReply('ok'))
    const { server } = calcServer()

    await collect(query({ prompt: 'hi', options: { mcpServers: { calc: server } } }))

    const tools = requestBody(fetchMock.mock.calls[0]).tools ?? []
    const add = tools.find((t) => t.function.name === ADD)
    expect(add).toMatchObject({
      type: 'function',
      function: {
        name: ADD,
        description: 'Складывает два числа',
        parameters: {
          type: 'object',
          properties: { a: { type: 'number' }, b: { type: 'number' } },
          required: ['a', 'b'],
        },
      },
    })
    expect(tools.map((t) => t.function.name)).toEqual(expect.arrayContaining([ADD, MUL]))
  })

  it('без mcpServers инструменты в запрос не уходят', async () => {
    const fetchMock = scriptedOllama(ollamaReply('ok'))

    await collect(query({ prompt: 'hi' }))

    const tools = requestBody(fetchMock.mock.calls[0]).tools
    expect(tools === undefined || tools.length === 0).toBe(true)
  })
})

describe('агентный цикл', () => {
  const allowCalc: Options = { allowedTools: [ADD, MUL] }

  it('выполняет инструмент и возвращает модели результат до финального ответа', async () => {
    scriptedOllama(toolCallReply({ name: ADD, arguments: { a: 2, b: 3 } }), ollamaReply('Будет 5'))
    const { server, addHandler } = calcServer()

    const messages = await collect(
      query({
        prompt: 'Сколько 2 + 3?',
        options: { ...allowCalc, tools: [], mcpServers: { calc: server } },
      }),
    )

    expect(messages.map((m) => m.type)).toEqual([
      'system',
      'assistant',
      'user',
      'assistant',
      'result',
    ])
    expect(addHandler).toHaveBeenCalledTimes(1)
    expect(addHandler.mock.calls[0][0]).toEqual({ a: 2, b: 3 })

    const [use] = toolUses(messages)
    expect(use).toMatchObject({ name: ADD, input: { a: 2, b: 3 } })
    expect(use.id).toEqual(expect.any(String))
    expect(use.id).not.toBe('')

    const firstAssistant = messages[1]
    if (firstAssistant.type !== 'assistant') throw new Error('нет assistant')
    expect(firstAssistant.message.stop_reason).toBe('tool_use')

    const user = messages[2]
    if (user.type !== 'user') throw new Error('нет user')
    expect(user.message.role).toBe('user')
    expect(user.parent_tool_use_id).toBeNull()
    expect(user.session_id).toBe(initMessage(messages).session_id)

    const [toolResult] = toolResults(messages)
    expect(toolResult.toolUseId).toBe(use.id)
    expect(toolResult.isError).toBe(false)
    expect(toolResult.text).toBe('5')

    const result = lastResult(messages)
    if (result.subtype !== 'success') throw new Error('нет success')
    expect(result.result).toBe('Будет 5')
    expect(result.num_turns).toBe(2)
    expect(result.is_error).toBe(false)
  })

  it('во второй запрос уходят вызов инструмента и его результат с ролью tool', async () => {
    const fetchMock = scriptedOllama(
      toolCallReply({ name: ADD, arguments: { a: 2, b: 3 } }),
      ollamaReply('5'),
    )
    const { server } = calcServer()

    await collect(
      query({ prompt: '2 + 3?', options: { ...allowCalc, mcpServers: { calc: server } } }),
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const second = requests(fetchMock)[1].messages
    expect(second[0]).toEqual({ role: 'user', content: '2 + 3?' })
    expect(second[1]).toMatchObject({
      role: 'assistant',
      tool_calls: [{ function: { name: ADD, arguments: { a: 2, b: 3 } } }],
    })
    expect(second[2]).toMatchObject({ role: 'tool', content: '5' })
  })

  it('выполняет несколько вызовов из одного ответа, у каждого свой tool_result', async () => {
    scriptedOllama(
      toolCallReply(
        { name: ADD, arguments: { a: 1, b: 2 } },
        { name: MUL, arguments: { a: 3, b: 4 } },
      ),
      ollamaReply('3 и 12'),
    )
    const { server, addHandler, mulHandler } = calcServer()

    const messages = await collect(
      query({ prompt: 'посчитай', options: { ...allowCalc, mcpServers: { calc: server } } }),
    )

    expect(addHandler).toHaveBeenCalledTimes(1)
    expect(mulHandler).toHaveBeenCalledTimes(1)
    const uses = toolUses(messages)
    const results = toolResults(messages)
    expect(uses.map((u) => u.name)).toEqual([ADD, MUL])
    expect(results.map((r) => r.toolUseId)).toEqual(uses.map((u) => u.id))
    expect(results.map((r) => r.text)).toEqual(['3', '12'])
  })

  it('ошибка обработчика — tool_result с is_error, цикл продолжается', async () => {
    scriptedOllama(
      toolCallReply({ name: 'mcp__fail__boom', arguments: {} }),
      ollamaReply('Не вышло'),
    )
    const boom = tool('boom', 'Падает', {}, async () => {
      throw new Error('диск недоступен')
    })
    const server = createSdkMcpServer({ name: 'fail', version: '1.0.0', tools: [boom] })

    const messages = await collect(
      query({
        prompt: 'go',
        options: { allowedTools: ['mcp__fail__boom'], mcpServers: { fail: server } },
      }),
    )

    const [toolResult] = toolResults(messages)
    expect(toolResult.isError).toBe(true)
    expect(toolResult.text).toContain('диск недоступен')
    expect(lastResult(messages).subtype).toBe('success')
  })

  it('результат инструмента с isError: true — tool_result с is_error', async () => {
    scriptedOllama(toolCallReply({ name: 'mcp__fail__soft', arguments: {} }), ollamaReply('ok'))
    const soft = tool('soft', 'Мягкая ошибка', {}, async () => ({
      content: [{ type: 'text' as const, text: 'нет такого файла' }],
      isError: true,
    }))
    const server = createSdkMcpServer({ name: 'fail', version: '1.0.0', tools: [soft] })

    const messages = await collect(
      query({
        prompt: 'go',
        options: { allowedTools: ['mcp__fail__soft'], mcpServers: { fail: server } },
      }),
    )

    const [toolResult] = toolResults(messages)
    expect(toolResult.isError).toBe(true)
    expect(toolResult.text).toContain('нет такого файла')
  })

  it('аргументы не по схеме — обработчик не вызывается, tool_result с is_error', async () => {
    scriptedOllama(
      toolCallReply({ name: ADD, arguments: { a: 'два', b: 3 } }),
      ollamaReply('Ошибся'),
    )
    const { server, addHandler } = calcServer()

    const messages = await collect(
      query({ prompt: 'go', options: { ...allowCalc, mcpServers: { calc: server } } }),
    )

    expect(addHandler).not.toHaveBeenCalled()
    const [toolResult] = toolResults(messages)
    expect(toolResult.isError).toBe(true)
    expect(lastResult(messages).subtype).toBe('success')
  })

  it('вызов неизвестного инструмента — tool_result с is_error, цикл продолжается', async () => {
    scriptedOllama(toolCallReply({ name: 'mcp__calc__pow', arguments: {} }), ollamaReply('ok'))
    const { server } = calcServer()

    const messages = await collect(
      query({ prompt: 'go', options: { ...allowCalc, mcpServers: { calc: server } } }),
    )

    const [toolResult] = toolResults(messages)
    expect(toolResult.isError).toBe(true)
    expect(lastResult(messages).subtype).toBe('success')
  })

  it('maxTurns ограничивает число ходов: result/error_max_turns', async () => {
    const fetchMock = scriptedOllama(toolCallReply({ name: ADD, arguments: { a: 1, b: 1 } }))
    const { server } = calcServer()

    const messages = await collect(
      query({
        prompt: 'go',
        options: { ...allowCalc, maxTurns: 2, mcpServers: { calc: server } },
      }),
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const result = lastResult(messages)
    expect(result.subtype).toBe('error_max_turns')
    expect(result.is_error).toBe(true)
    if (result.subtype === 'success') throw new Error('ожидалась ошибка')
    expect(result.errors).toEqual(expect.any(Array))
  })

  it('финальный ответ в пределах maxTurns — success', async () => {
    scriptedOllama(toolCallReply({ name: ADD, arguments: { a: 1, b: 1 } }), ollamaReply('2'))
    const { server } = calcServer()

    const messages = await collect(
      query({
        prompt: 'go',
        options: { ...allowCalc, maxTurns: 2, mcpServers: { calc: server } },
      }),
    )

    expect(lastResult(messages).subtype).toBe('success')
  })

  it('потоковый prompt: цикл с инструментами на каждое сообщение пользователя', async () => {
    scriptedOllama(
      toolCallReply({ name: ADD, arguments: { a: 1, b: 1 } }),
      ollamaReply('2'),
      toolCallReply({ name: MUL, arguments: { a: 2, b: 5 } }),
      ollamaReply('10'),
    )
    const { server } = calcServer()

    const messages = await collect(
      query({
        prompt: userMessages('1 + 1?', '2 * 5?'),
        options: { ...allowCalc, mcpServers: { calc: server } },
      }),
    )

    const results = messages.filter((m) => m.type === 'result')
    expect(results.map((r) => (r.subtype === 'success' ? r.result : r.subtype))).toEqual([
      '2',
      '10',
    ])
  })
})

describe('агентный цикл: устойчивость', () => {
  it('interrupt() после assistant с tool_use — инструмент не выполняется', async () => {
    scriptedOllama(toolCallReply({ name: ADD, arguments: { a: 1, b: 2 } }), ollamaReply('3'))
    const { server, addHandler } = calcServer()
    const q = query({
      prompt: 'go',
      options: { allowedTools: [ADD], mcpServers: { calc: server } },
    })

    const types: string[] = []
    for await (const message of q) {
      types.push(message.type)
      if (message.type === 'assistant') await q.interrupt()
    }

    expect(types).toEqual(['system', 'assistant'])
    expect(addHandler).not.toHaveBeenCalled()
  })

  it('обработчик вернул не CallToolResult — tool_result с is_error, сессия не падает', async () => {
    scriptedOllama(toolCallReply({ name: 'mcp__bad__oops', arguments: {} }), ollamaReply('ok'))
    const oops = tool('oops', 'Возвращает мусор', {}, (async () => undefined) as never)
    const server = createSdkMcpServer({ name: 'bad', version: '1.0.0', tools: [oops] })

    const messages = await collect(
      query({ prompt: 'go', options: { allowedTools: ['mcp__bad'], mcpServers: { bad: server } } }),
    )

    expect(toolResults(messages)[0].isError).toBe(true)
    expect(lastResult(messages).subtype).toBe('success')
  })

  it('поле, которое не выражается в JSON Schema, не роняет query()', async () => {
    const fetchMock = scriptedOllama(ollamaReply('ok'))
    const when = tool('when', 'Дата', { at: z.date() }, async () => ({ content: [] }))
    const server = createSdkMcpServer({ name: 'cal', version: '1.0.0', tools: [when] })

    await collect(query({ prompt: 'go', options: { mcpServers: { cal: server } } }))

    const names = (requestBody(fetchMock.mock.calls[0]).tools ?? []).map((t) => t.function.name)
    expect(names).toEqual(['mcp__cal__when'])
  })

  it('allowedTools с mcp__<server>__* разрешает все инструменты сервера', async () => {
    scriptedOllama(toolCallReply({ name: MUL, arguments: { a: 2, b: 3 } }), ollamaReply('6'))
    const { server, mulHandler } = calcServer()

    await collect(
      query({
        prompt: 'go',
        options: { allowedTools: ['mcp__calc__*'], mcpServers: { calc: server } },
      }),
    )

    expect(mulHandler).toHaveBeenCalledTimes(1)
  })
})

describe('права: allowedTools, disallowedTools, canUseTool', () => {
  it('инструмент из allowedTools выполняется без canUseTool', async () => {
    scriptedOllama(toolCallReply({ name: ADD, arguments: { a: 1, b: 2 } }), ollamaReply('3'))
    const { server, addHandler } = calcServer()
    const canUseTool = vi.fn(async () => ({ behavior: 'deny' as const, message: 'нет' }))

    await collect(
      query({
        prompt: 'go',
        options: { allowedTools: [ADD], canUseTool, mcpServers: { calc: server } },
      }),
    )

    expect(addHandler).toHaveBeenCalledTimes(1)
    expect(canUseTool).not.toHaveBeenCalled()
  })

  it('allowedTools с именем сервера mcp__<server> разрешает все его инструменты', async () => {
    scriptedOllama(toolCallReply({ name: MUL, arguments: { a: 2, b: 3 } }), ollamaReply('6'))
    const { server, mulHandler } = calcServer()

    await collect(
      query({
        prompt: 'go',
        options: { allowedTools: ['mcp__calc'], mcpServers: { calc: server } },
      }),
    )

    expect(mulHandler).toHaveBeenCalledTimes(1)
  })

  it('не разрешённый инструмент без canUseTool не выполняется и попадает в permission_denials', async () => {
    scriptedOllama(toolCallReply({ name: ADD, arguments: { a: 1, b: 2 } }), ollamaReply('Нельзя'))
    const { server, addHandler } = calcServer()

    const messages = await collect(
      query({ prompt: 'go', options: { mcpServers: { calc: server } } }),
    )

    expect(addHandler).not.toHaveBeenCalled()
    const [use] = toolUses(messages)
    const [toolResult] = toolResults(messages)
    expect(toolResult.toolUseId).toBe(use.id)
    expect(toolResult.isError).toBe(true)
    expect(lastResult(messages).permission_denials).toEqual([
      { tool_name: ADD, tool_use_id: use.id, tool_input: { a: 1, b: 2 } },
    ])
  })

  it('canUseTool получает имя, ввод и signal; allow выполняет инструмент', async () => {
    scriptedOllama(toolCallReply({ name: ADD, arguments: { a: 1, b: 2 } }), ollamaReply('3'))
    const { server, addHandler } = calcServer()
    const canUseTool = vi.fn(async () => ({ behavior: 'allow' as const }))

    await collect(query({ prompt: 'go', options: { canUseTool, mcpServers: { calc: server } } }))

    expect(canUseTool).toHaveBeenCalledTimes(1)
    expect(canUseTool).toHaveBeenCalledWith(
      ADD,
      { a: 1, b: 2 },
      expect.objectContaining({ signal: expect.any(AbortSignal) as unknown }),
    )
    expect(addHandler).toHaveBeenCalledTimes(1)
  })

  it('canUseTool allow с updatedInput меняет ввод обработчика', async () => {
    scriptedOllama(toolCallReply({ name: ADD, arguments: { a: 1, b: 2 } }), ollamaReply('ok'))
    const { server, addHandler } = calcServer()
    const canUseTool = vi.fn(async () => ({
      behavior: 'allow' as const,
      updatedInput: { a: 10, b: 20 },
    }))

    const messages = await collect(
      query({ prompt: 'go', options: { canUseTool, mcpServers: { calc: server } } }),
    )

    expect(addHandler.mock.calls[0][0]).toEqual({ a: 10, b: 20 })
    expect(toolResults(messages)[0].text).toBe('30')
  })

  it('canUseTool deny блокирует инструмент: сообщение в tool_result и permission_denials', async () => {
    const fetchMock = scriptedOllama(
      toolCallReply({ name: ADD, arguments: { a: 1, b: 2 } }),
      ollamaReply('Не дали'),
    )
    const { server, addHandler } = calcServer()
    const canUseTool = vi.fn(async () => ({
      behavior: 'deny' as const,
      message: 'Сложение запрещено',
    }))

    const messages = await collect(
      query({ prompt: 'go', options: { canUseTool, mcpServers: { calc: server } } }),
    )

    expect(addHandler).not.toHaveBeenCalled()
    const [toolResult] = toolResults(messages)
    expect(toolResult.isError).toBe(true)
    expect(toolResult.text).toContain('Сложение запрещено')
    const [use] = toolUses(messages)
    expect(lastResult(messages).permission_denials).toEqual([
      { tool_name: ADD, tool_use_id: use.id, tool_input: { a: 1, b: 2 } },
    ])
    // Модель узнаёт об отказе и отвечает дальше.
    expect(requests(fetchMock)[1].messages.at(-1)).toMatchObject({ role: 'tool' })
    expect(lastResult(messages).subtype).toBe('success')
  })

  it('disallowedTools убирает инструмент из запроса к модели и из system/init', async () => {
    const fetchMock = scriptedOllama(ollamaReply('ok'))
    const { server } = calcServer()

    const messages = await collect(
      query({
        prompt: 'go',
        options: { disallowedTools: [MUL], allowedTools: [ADD, MUL], mcpServers: { calc: server } },
      }),
    )

    const names = (requestBody(fetchMock.mock.calls[0]).tools ?? []).map((t) => t.function.name)
    expect(names).toContain(ADD)
    expect(names).not.toContain(MUL)
    expect(initMessage(messages).tools).not.toContain(MUL)
  })

  it('disallowedTools блокирует вызов даже из allowedTools и при bypassPermissions', async () => {
    scriptedOllama(toolCallReply({ name: MUL, arguments: { a: 2, b: 3 } }), ollamaReply('ok'))
    const { server, mulHandler } = calcServer()

    const messages = await collect(
      query({
        prompt: 'go',
        options: {
          disallowedTools: [MUL],
          allowedTools: [MUL],
          permissionMode: 'bypassPermissions',
          mcpServers: { calc: server },
        },
      }),
    )

    expect(mulHandler).not.toHaveBeenCalled()
    expect(toolResults(messages)[0].isError).toBe(true)
  })
})

describe('права: permissionMode', () => {
  it('default: без allowedTools решение принимает canUseTool', async () => {
    scriptedOllama(toolCallReply({ name: ADD, arguments: { a: 1, b: 2 } }), ollamaReply('ok'))
    const { server } = calcServer()
    const canUseTool = vi.fn(async () => ({ behavior: 'allow' as const }))

    await collect(
      query({
        prompt: 'go',
        options: { permissionMode: 'default', canUseTool, mcpServers: { calc: server } },
      }),
    )

    expect(canUseTool).toHaveBeenCalledTimes(1)
  })

  it('acceptEdits: для SDK-инструментов как default — спрашивается canUseTool', async () => {
    scriptedOllama(toolCallReply({ name: ADD, arguments: { a: 1, b: 2 } }), ollamaReply('ok'))
    const { server, addHandler } = calcServer()
    const canUseTool = vi.fn(async () => ({ behavior: 'deny' as const, message: 'нет' }))

    const messages = await collect(
      query({
        prompt: 'go',
        options: { permissionMode: 'acceptEdits', canUseTool, mcpServers: { calc: server } },
      }),
    )

    expect(canUseTool).toHaveBeenCalledTimes(1)
    expect(addHandler).not.toHaveBeenCalled()
    expect(initMessage(messages).permissionMode).toBe('acceptEdits')
  })

  it('bypassPermissions: инструмент выполняется без allowedTools и без canUseTool', async () => {
    scriptedOllama(toolCallReply({ name: ADD, arguments: { a: 1, b: 2 } }), ollamaReply('3'))
    const { server, addHandler } = calcServer()
    const canUseTool = vi.fn(async () => ({ behavior: 'deny' as const, message: 'нет' }))

    const messages = await collect(
      query({
        prompt: 'go',
        options: { permissionMode: 'bypassPermissions', canUseTool, mcpServers: { calc: server } },
      }),
    )

    expect(addHandler).toHaveBeenCalledTimes(1)
    expect(canUseTool).not.toHaveBeenCalled()
    expect(lastResult(messages).permission_denials).toEqual([])
  })

  it('plan: инструменты не выполняются даже из allowedTools, модель получает отказ', async () => {
    scriptedOllama(toolCallReply({ name: ADD, arguments: { a: 1, b: 2 } }), ollamaReply('План'))
    const { server, addHandler } = calcServer()
    const canUseTool = vi.fn(async () => ({ behavior: 'allow' as const }))

    const messages = await collect(
      query({
        prompt: 'go',
        options: {
          permissionMode: 'plan',
          allowedTools: [ADD],
          canUseTool,
          mcpServers: { calc: server },
        },
      }),
    )

    expect(addHandler).not.toHaveBeenCalled()
    expect(canUseTool).not.toHaveBeenCalled()
    expect(toolResults(messages)[0].isError).toBe(true)
    expect(lastResult(messages).subtype).toBe('success')
  })
})

describe('хуки', () => {
  const allowAdd: Options = { allowedTools: [ADD, MUL] }

  it('PreToolUse получает имя, ввод и id вызова; второй аргумент — тот же id', async () => {
    scriptedOllama(toolCallReply({ name: ADD, arguments: { a: 1, b: 2 } }), ollamaReply('3'))
    const { server } = calcServer()
    const hook = vi.fn(async () => ({}))

    const messages = await collect(
      query({
        prompt: 'go',
        options: {
          ...allowAdd,
          mcpServers: { calc: server },
          hooks: { PreToolUse: [{ hooks: [hook] }] },
        },
      }),
    )

    const [use] = toolUses(messages)
    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({
        hook_event_name: 'PreToolUse',
        tool_name: ADD,
        tool_input: { a: 1, b: 2 },
        tool_use_id: use.id,
        session_id: initMessage(messages).session_id,
      }),
      use.id,
      expect.objectContaining({ signal: expect.any(AbortSignal) as unknown }),
    )
  })

  it('PreToolUse deny блокирует инструмент, причина уходит модели, canUseTool не вызывается', async () => {
    const fetchMock = scriptedOllama(
      toolCallReply({ name: ADD, arguments: { a: 1, b: 2 } }),
      ollamaReply('Заблокировано'),
    )
    const { server, addHandler } = calcServer()
    const canUseTool = vi.fn(async () => ({ behavior: 'allow' as const }))
    const deny = vi.fn(async () => ({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse' as const,
        permissionDecision: 'deny' as const,
        permissionDecisionReason: 'Сложение под запретом',
      },
    }))

    const messages = await collect(
      query({
        prompt: 'go',
        options: {
          ...allowAdd,
          canUseTool,
          mcpServers: { calc: server },
          hooks: { PreToolUse: [{ matcher: ADD, hooks: [deny] }] },
        },
      }),
    )

    expect(addHandler).not.toHaveBeenCalled()
    expect(canUseTool).not.toHaveBeenCalled()
    const [toolResult] = toolResults(messages)
    expect(toolResult.isError).toBe(true)
    expect(toolResult.text).toContain('Сложение под запретом')
    expect(requests(fetchMock)[1].messages.at(-1)?.content).toContain('Сложение под запретом')
    expect(lastResult(messages).subtype).toBe('success')
  })

  it('PreToolUse с updatedInput меняет ввод обработчика', async () => {
    scriptedOllama(toolCallReply({ name: ADD, arguments: { a: 1, b: 2 } }), ollamaReply('ok'))
    const { server, addHandler } = calcServer()
    const rewrite = vi.fn(async () => ({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse' as const,
        permissionDecision: 'allow' as const,
        updatedInput: { a: 100, b: 1 },
      },
    }))

    const messages = await collect(
      query({
        prompt: 'go',
        options: {
          ...allowAdd,
          mcpServers: { calc: server },
          hooks: { PreToolUse: [{ hooks: [rewrite] }] },
        },
      }),
    )

    expect(addHandler.mock.calls[0][0]).toEqual({ a: 100, b: 1 })
    expect(toolResults(messages)[0].text).toBe('101')
  })

  it('PreToolUse allow разрешает инструмент вне allowedTools без canUseTool', async () => {
    scriptedOllama(toolCallReply({ name: ADD, arguments: { a: 1, b: 2 } }), ollamaReply('3'))
    const { server, addHandler } = calcServer()
    const canUseTool = vi.fn(async () => ({ behavior: 'deny' as const, message: 'нет' }))
    const allow = vi.fn(async () => ({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse' as const,
        permissionDecision: 'allow' as const,
      },
    }))

    await collect(
      query({
        prompt: 'go',
        options: {
          canUseTool,
          mcpServers: { calc: server },
          hooks: { PreToolUse: [{ hooks: [allow] }] },
        },
      }),
    )

    expect(addHandler).toHaveBeenCalledTimes(1)
    expect(canUseTool).not.toHaveBeenCalled()
  })

  it('matcher хука — регулярное выражение по имени инструмента', async () => {
    scriptedOllama(
      toolCallReply(
        { name: ADD, arguments: { a: 1, b: 2 } },
        { name: MUL, arguments: { a: 2, b: 3 } },
      ),
      ollamaReply('ok'),
    )
    const { server } = calcServer()
    const onlyAdd = vi.fn(async () => ({}))
    const anyCalc = vi.fn(async () => ({}))
    const all = vi.fn(async () => ({}))
    const other = vi.fn(async () => ({}))

    await collect(
      query({
        prompt: 'go',
        options: {
          ...allowAdd,
          mcpServers: { calc: server },
          hooks: {
            PreToolUse: [
              { matcher: ADD, hooks: [onlyAdd] },
              { matcher: 'mcp__calc__.*', hooks: [anyCalc] },
              { hooks: [all] },
              { matcher: 'mcp__other__.*', hooks: [other] },
            ],
          },
        },
      }),
    )

    expect(onlyAdd).toHaveBeenCalledTimes(1)
    expect(onlyAdd).toHaveBeenCalledWith(
      expect.objectContaining({ tool_name: ADD }),
      expect.any(String),
      expect.anything(),
    )
    expect(anyCalc).toHaveBeenCalledTimes(2)
    expect(all).toHaveBeenCalledTimes(2)
    expect(other).not.toHaveBeenCalled()
  })

  it('PostToolUse вызывается после выполнения с результатом инструмента', async () => {
    scriptedOllama(toolCallReply({ name: ADD, arguments: { a: 1, b: 2 } }), ollamaReply('3'))
    const { server, addHandler } = calcServer()
    const post = vi.fn(async () => {
      expect(addHandler).toHaveBeenCalledTimes(1)
      return {}
    })

    const messages = await collect(
      query({
        prompt: 'go',
        options: {
          ...allowAdd,
          mcpServers: { calc: server },
          hooks: { PostToolUse: [{ matcher: ADD, hooks: [post] }] },
        },
      }),
    )

    const [use] = toolUses(messages)
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        hook_event_name: 'PostToolUse',
        tool_name: ADD,
        tool_input: { a: 1, b: 2 },
        tool_use_id: use.id,
        tool_response: expect.anything() as unknown,
      }),
      use.id,
      expect.anything(),
    )
  })

  it('PostToolUse не вызывается для заблокированного инструмента', async () => {
    scriptedOllama(toolCallReply({ name: ADD, arguments: { a: 1, b: 2 } }), ollamaReply('ok'))
    const { server } = calcServer()
    const post = vi.fn(async () => ({}))

    await collect(
      query({
        prompt: 'go',
        options: { mcpServers: { calc: server }, hooks: { PostToolUse: [{ hooks: [post] }] } },
      }),
    )

    expect(post).not.toHaveBeenCalled()
  })

  it('UserPromptSubmit получает текст каждого сообщения пользователя до запроса к модели', async () => {
    const fetchMock = scriptedOllama(ollamaReply('ok'))
    const submit = vi.fn(async () => {
      return {}
    })

    await collect(
      query({
        prompt: userMessages('первое', 'второе'),
        options: { hooks: { UserPromptSubmit: [{ hooks: [submit] }] } },
      }),
    )

    expect(submit).toHaveBeenCalledTimes(2)
    expect(submit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ hook_event_name: 'UserPromptSubmit', prompt: 'первое' }),
      undefined,
      expect.anything(),
    )
    expect(submit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ hook_event_name: 'UserPromptSubmit', prompt: 'второе' }),
      undefined,
      expect.anything(),
    )
    expect(submit.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0])
  })

  it('Stop вызывается по финальному ответу, stop_hook_active = false', async () => {
    scriptedOllama(toolCallReply({ name: ADD, arguments: { a: 1, b: 2 } }), ollamaReply('3'))
    const { server } = calcServer()
    const stop = vi.fn(async () => ({}))

    await collect(
      query({
        prompt: 'go',
        options: {
          ...allowAdd,
          mcpServers: { calc: server },
          hooks: { Stop: [{ hooks: [stop] }] },
        },
      }),
    )

    expect(stop).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledWith(
      expect.objectContaining({ hook_event_name: 'Stop', stop_hook_active: false }),
      undefined,
      expect.anything(),
    )
  })

  it('SessionStart (source startup) — до первого запроса; matcher по source', async () => {
    const fetchMock = scriptedOllama(ollamaReply('ok'))
    const startup = vi.fn(async () => ({}))
    const resume = vi.fn(async () => ({}))

    const messages = await collect(
      query({
        prompt: 'hi',
        options: {
          hooks: {
            SessionStart: [
              { matcher: 'startup', hooks: [startup] },
              { matcher: 'resume', hooks: [resume] },
            ],
          },
        },
      }),
    )

    expect(startup).toHaveBeenCalledTimes(1)
    expect(startup).toHaveBeenCalledWith(
      expect.objectContaining({
        hook_event_name: 'SessionStart',
        source: 'startup',
        session_id: initMessage(messages).session_id,
      }),
      undefined,
      expect.anything(),
    )
    expect(resume).not.toHaveBeenCalled()
    expect(startup.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0])
  })

  it('SessionEnd вызывается один раз по окончании сессии; matcher по reason', async () => {
    scriptedOllama(ollamaReply('ok'))
    const end = vi.fn(async () => ({}))
    const logout = vi.fn(async () => ({}))

    const messages = await collect(
      query({
        prompt: 'hi',
        options: {
          hooks: {
            SessionEnd: [
              { matcher: 'other', hooks: [end] },
              { matcher: 'logout', hooks: [logout] },
            ],
          },
        },
      }),
    )

    expect(end).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledWith(
      expect.objectContaining({
        hook_event_name: 'SessionEnd',
        reason: 'other',
        session_id: initMessage(messages).session_id,
      }),
      undefined,
      expect.anything(),
    )
    expect(logout).not.toHaveBeenCalled()
  })

  it('порядок событий: SessionStart → UserPromptSubmit → PreToolUse → PostToolUse → Stop → SessionEnd', async () => {
    scriptedOllama(toolCallReply({ name: ADD, arguments: { a: 1, b: 2 } }), ollamaReply('3'))
    const { server } = calcServer()
    const events: string[] = []
    const record = (name: string) => async () => {
      events.push(name)
      return {}
    }

    await collect(
      query({
        prompt: 'go',
        options: {
          ...allowAdd,
          mcpServers: { calc: server },
          hooks: {
            SessionStart: [{ hooks: [record('SessionStart')] }],
            UserPromptSubmit: [{ hooks: [record('UserPromptSubmit')] }],
            PreToolUse: [{ hooks: [record('PreToolUse')] }],
            PostToolUse: [{ hooks: [record('PostToolUse')] }],
            Stop: [{ hooks: [record('Stop')] }],
            SessionEnd: [{ hooks: [record('SessionEnd')] }],
          },
        },
      }),
    )

    expect(events).toEqual([
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'Stop',
      'SessionEnd',
    ])
  })
})

describe('контроль размера контекста', () => {
  // Оценка объёма запроса в тестах — консервативная: не больше 4 символов на токен.
  const CHARS_PER_TOKEN = 4
  const NUM_CTX = 2048

  function contentLength(body: OllamaRequestBody): number {
    return body.messages.reduce((sum, message) => sum + message.content.length, 0)
  }

  /** Сервер `docs` с `read`: каждый вызов отдаёт `size` символов своей буквы. */
  function docsServer(size: number) {
    const read = tool('read', 'Читает часть документа', { part: z.number() }, async ({ part }) => ({
      content: [{ type: 'text' as const, text: String.fromCharCode(65 + part).repeat(size) }],
    }))
    return createSdkMcpServer({ name: 'docs', version: '1.0.0', tools: [read] })
  }

  const READ = 'mcp__docs__read'

  it('усекает старые результаты инструментов, последний оставляет целиком', async () => {
    vi.stubEnv('OLLAMA_NUM_CTX', String(NUM_CTX))
    const calls = [0, 1, 2, 3, 4].map((part) => toolCallReply({ name: READ, arguments: { part } }))
    const fetchMock = scriptedOllama(...calls, ollamaReply('Готово'))

    const messages = await collect(
      query({
        prompt: 'Прочитай документ',
        options: {
          systemPrompt: 'Ты читаешь документы.',
          allowedTools: [READ],
          mcpServers: { docs: docsServer(3000) },
        },
      }),
    )

    expect(lastResult(messages).subtype).toBe('success')
    const bodies = requests(fetchMock)
    expect(bodies).toHaveLength(6)
    for (const body of bodies) {
      expect(contentLength(body)).toBeLessThanOrEqual(NUM_CTX * CHARS_PER_TOKEN)
    }

    const last = bodies[5].messages
    expect(last[0]).toEqual({ role: 'system', content: 'Ты читаешь документы.' })
    expect(last[1]).toEqual({ role: 'user', content: 'Прочитай документ' })
    // Пары «вызов — результат» сохраняются, усекается только содержимое.
    const toolMessages = last.filter((m) => m.role === 'tool')
    expect(toolMessages).toHaveLength(5)
    expect(toolMessages[0].content.length).toBeLessThan(3000)
    expect(toolMessages[4].content).toBe('E'.repeat(3000))
  })

  it('сообщения, отданные вызывающему коду, содержат полные результаты', async () => {
    vi.stubEnv('OLLAMA_NUM_CTX', String(NUM_CTX))
    const calls = [0, 1, 2, 3].map((part) => toolCallReply({ name: READ, arguments: { part } }))
    scriptedOllama(...calls, ollamaReply('Готово'))

    const messages = await collect(
      query({
        prompt: 'go',
        options: { allowedTools: [READ], mcpServers: { docs: docsServer(3000) } },
      }),
    )

    expect(toolResults(messages).map((r) => r.text.length)).toEqual([3000, 3000, 3000, 3000])
  })

  it('результат больше всего num_ctx усекается, цикл не падает', async () => {
    vi.stubEnv('OLLAMA_NUM_CTX', String(NUM_CTX))
    const fetchMock = scriptedOllama(
      toolCallReply({ name: READ, arguments: { part: 0 } }),
      ollamaReply('Слишком длинно, но ответ есть'),
    )

    const messages = await collect(
      query({
        prompt: 'go',
        options: { allowedTools: [READ], mcpServers: { docs: docsServer(20_000) } },
      }),
    )

    expect(lastResult(messages).subtype).toBe('success')
    const [, second] = requests(fetchMock)
    expect(contentLength(second)).toBeLessThanOrEqual(NUM_CTX * CHARS_PER_TOKEN)
    expect(second.messages.filter((m) => m.role === 'tool')).toHaveLength(1)
  })

  it('пока вход помещается в num_ctx, результаты не усекаются', async () => {
    const calls = [0, 1, 2].map((part) => toolCallReply({ name: READ, arguments: { part } }))
    const fetchMock = scriptedOllama(...calls, ollamaReply('Готово'))

    await collect(
      query({
        prompt: 'go',
        options: { allowedTools: [READ], mcpServers: { docs: docsServer(3000) } },
      }),
    )

    const last = requests(fetchMock).at(-1)
    const toolMessages = last?.messages.filter((m) => m.role === 'tool') ?? []
    expect(toolMessages.map((m) => m.content.length)).toEqual([3000, 3000, 3000])
  })
})

describe('ревью фазы 2: сбои хуков, зависшие обработчики, num_predict, переполнение', () => {
  let emitWarning: MockInstance
  beforeEach(() => {
    emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('исключение хука PreToolUse — отказ (fail-closed) даже при bypassPermissions', async () => {
    scriptedOllama(toolCallReply({ name: ADD, arguments: { a: 1, b: 2 } }), ollamaReply('Нет'))
    const { server, addHandler } = calcServer()
    const failing = vi.fn(() => Promise.reject(new Error('db is down')))

    const messages = await collect(
      query({
        prompt: 'go',
        options: {
          permissionMode: 'bypassPermissions',
          mcpServers: { calc: server },
          hooks: { PreToolUse: [{ hooks: [failing] }] },
        },
      }),
    )

    expect(addHandler).not.toHaveBeenCalled()
    const [result] = toolResults(messages)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('PreToolUse hook failed: db is down')
    expect(lastResult(messages).permission_denials).toHaveLength(1)
    expect(emitWarning).toHaveBeenCalledWith(
      expect.stringContaining('PreToolUse hook failed: db is down'),
      expect.objectContaining({ code: 'LLM_SDK_HOOK_FAILED' }),
    )
  })

  it('исключение хука других событий пропускается с предупреждением', async () => {
    scriptedOllama(ollamaReply('Готово'))
    const failing = vi.fn(() => Promise.reject(new Error('boom')))

    const messages = await collect(
      query({ prompt: 'go', options: { hooks: { Stop: [{ hooks: [failing] }] } } }),
    )

    expect(lastResult(messages).subtype).toBe('success')
    expect(emitWarning).toHaveBeenCalledWith(
      'Stop hook failed: boom',
      expect.objectContaining({ code: 'LLM_SDK_HOOK_FAILED' }),
    )
  })

  it('interrupt() завершает сессию, даже если обработчик не слушает signal и не завершается', async () => {
    scriptedOllama(toolCallReply({ name: 'mcp__slow__hang', arguments: {} }), ollamaReply('?'))
    const hang = tool('hang', 'Никогда не завершается', {}, () => new Promise<never>(() => {}))
    const server = createSdkMcpServer({ name: 'slow', version: '1.0.0', tools: [hang] })
    const q = query({
      prompt: 'go',
      options: { permissionMode: 'bypassPermissions', mcpServers: { slow: server } },
    })

    const types: string[] = []
    const done = (async () => {
      for await (const message of q) types.push(message.type)
    })()
    await vi.waitFor(() => expect(types).toContain('assistant'))
    await q.interrupt()
    await done

    expect(types).toEqual(['system', 'assistant'])
  })

  it('interrupt() не ждёт зависший canUseTool', async () => {
    scriptedOllama(toolCallReply({ name: ADD, arguments: { a: 1, b: 2 } }), ollamaReply('?'))
    const { server, addHandler } = calcServer()
    const canUseTool = vi.fn(() => new Promise<never>(() => {}))
    const q = query({ prompt: 'go', options: { mcpServers: { calc: server }, canUseTool } })

    const types: string[] = []
    const done = (async () => {
      for await (const message of q) types.push(message.type)
    })()
    await vi.waitFor(() => expect(canUseTool).toHaveBeenCalled())
    await q.interrupt()
    await done

    expect(types).toEqual(['system', 'assistant'])
    expect(addHandler).not.toHaveBeenCalled()
  })

  it('num_predict ограничивает ответ остатком окна; он же — maxOutputTokens в result', async () => {
    vi.stubEnv('OLLAMA_NUM_CTX', '8192')
    const fetchMock = scriptedOllama(ollamaReply('Ок'))

    const messages = await collect(query({ prompt: 'Привет' }))

    const body = requestBody(fetchMock.mock.calls[0]) as OllamaRequestBody & {
      options: { num_ctx: number; num_predict: number }
    }
    expect(body.options.num_ctx).toBe(8192)
    // Запас под ответ — четверть окна; на короткий вход остаётся почти всё окно.
    expect(body.options.num_predict).toBeGreaterThanOrEqual(2048)
    expect(body.options.num_predict).toBeLessThan(8192)
    const usage = Object.values(lastResult(messages).modelUsage)[0]
    expect(usage.maxOutputTokens).toBe(body.options.num_predict)
  })

  it('системный промпт больше num_ctx: запрос не уходит, result/error_during_execution', async () => {
    vi.stubEnv('OLLAMA_NUM_CTX', '2048')
    const fetchMock = scriptedOllama(ollamaReply('не должно быть'))

    const messages = await collect(
      query({ prompt: 'go', options: { systemPrompt: 'x'.repeat(20_000) } }),
    )

    expect(fetchMock).not.toHaveBeenCalled()
    const result = lastResult(messages)
    expect(result.subtype).toBe('error_during_execution')
    expect(result.is_error).toBe(true)
    expect(result.subtype !== 'success' && result.errors[0]).toMatch(/^Context window exceeded/)
  })

  it('длинная цепочка: старые обмены схлопываются в пометку, запрос помещается в num_ctx', async () => {
    const NUM_CTX = 2048
    vi.stubEnv('OLLAMA_NUM_CTX', String(NUM_CTX))
    const read = tool('read', 'Читает часть', { part: z.number() }, async ({ part }) => ({
      content: [{ type: 'text' as const, text: `часть ${part}: ` + 'д'.repeat(200) }],
    }))
    const server = createSdkMcpServer({ name: 'docs', version: '1.0.0', tools: [read] })
    const READ_TOOL = 'mcp__docs__read'
    const calls = Array.from({ length: 120 }, (_, part) =>
      toolCallReply({ name: READ_TOOL, arguments: { part } }),
    )
    const fetchMock = scriptedOllama(...calls, ollamaReply('Готово'))

    const messages = await collect(
      query({
        prompt: 'Прочитай всё',
        options: { allowedTools: [READ_TOOL], mcpServers: { docs: server } },
      }),
    )

    expect(lastResult(messages).subtype).toBe('success')
    const bodies = requests(fetchMock)
    expect(bodies).toHaveLength(121)
    for (const body of bodies) {
      const chars = body.messages.reduce(
        (sum, m) => sum + m.content.length + JSON.stringify(m.tool_calls ?? '').length,
        0,
      )
      expect(chars).toBeLessThanOrEqual(NUM_CTX * 4)
    }
    const last = bodies[120].messages
    expect(last[0]).toEqual({ role: 'user', content: 'Прочитай всё' })
    expect(last[1].content).toMatch(/^\[\d+ earlier tool calls and their results were omitted/)
    // Последний обмен остаётся целиком.
    expect(last.at(-1)).toEqual(
      expect.objectContaining({ role: 'tool', content: `часть 119: ` + 'д'.repeat(200) }),
    )
  })
})
