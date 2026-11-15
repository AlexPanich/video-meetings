// Тесты фазы 3: `outputFormat: { type: 'json_schema', schema }` → `structured_output` с проверкой
// по схеме и ограниченными повторами. Транспорт Ollama — мок-`fetch`.
import { createSdkMcpServer, query, tool } from './index.js'
import type { Options } from './index.js'
import {
  collect,
  lastResult,
  ollamaReply,
  requests,
  scriptedOllama,
  stubOllamaEnv,
  toolCallReply,
  userMessages,
} from './testing/ollama-mock.js'

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    decisions: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'decisions'],
  additionalProperties: false,
}

const VALID = { summary: 'Обсудили релиз', decisions: ['Релиз в пятницу'] }

/** Попыток всего: первая и два повтора. */
const MAX_ATTEMPTS = 3

function structuredOptions(extra: Options = {}): Options {
  return { outputFormat: { type: 'json_schema', schema: SCHEMA }, ...extra }
}

function meetingServer() {
  const handler = vi.fn(async () => ({
    content: [{ type: 'text' as const, text: 'Решили выпустить релиз в пятницу.' }],
  }))
  const readNotes = tool('read_notes', 'Читает заметки встречи', {}, handler)
  return {
    server: createSdkMcpServer({ name: 'meeting', version: '1.0.0', tools: [readNotes] }),
    handler,
  }
}

beforeEach(() => {
  stubOllamaEnv()
})

describe('outputFormat: structured_output', () => {
  it('схема уходит в Ollama как format', async () => {
    const fetchMock = scriptedOllama(ollamaReply(JSON.stringify(VALID)))

    await collect(query({ prompt: 'Саммари', options: structuredOptions() }))

    expect(requests(fetchMock)[0].format).toEqual(SCHEMA)
  })

  it('валидный ответ — result/success с разобранным structured_output', async () => {
    scriptedOllama(ollamaReply(JSON.stringify(VALID)))

    const messages = await collect(query({ prompt: 'Саммари', options: structuredOptions() }))

    const result = lastResult(messages)
    expect(result.subtype).toBe('success')
    if (result.subtype !== 'success') return
    expect(result.is_error).toBe(false)
    expect(result.structured_output).toEqual(VALID)
    expect(JSON.parse(result.result)).toEqual(VALID)
  })

  it('без outputFormat поле format не уходит и structured_output нет', async () => {
    const fetchMock = scriptedOllama(ollamaReply('Просто текст'))

    const messages = await collect(query({ prompt: 'Привет' }))

    expect(requests(fetchMock)[0]).not.toHaveProperty('format')
    const result = lastResult(messages)
    expect(result).not.toHaveProperty('structured_output')
  })

  it('рассуждение <think> перед JSON не мешает разбору', async () => {
    scriptedOllama(ollamaReply(`<think>подумаю</think>\n${JSON.stringify(VALID)}`))

    const messages = await collect(query({ prompt: 'Саммари', options: structuredOptions() }))

    const result = lastResult(messages)
    if (result.subtype !== 'success') throw new Error(`получен ${result.subtype}`)
    expect(result.structured_output).toEqual(VALID)
  })
})

describe('outputFormat: проверка по схеме и повторы', () => {
  it('ответ не JSON — повтор с объяснением ошибки, затем success', async () => {
    const fetchMock = scriptedOllama(
      ollamaReply('Вот саммари: обсудили релиз'),
      ollamaReply(JSON.stringify(VALID)),
    )

    const messages = await collect(query({ prompt: 'Саммари', options: structuredOptions() }))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const retry = requests(fetchMock)[1]
    const [invalid, feedback] = retry.messages.slice(-2)
    // Модель видит свой неверный ответ и сообщение об ошибке.
    expect(invalid).toMatchObject({ role: 'assistant', content: 'Вот саммари: обсудили релиз' })
    expect(feedback.role).toBe('user')
    expect(feedback.content).toMatch(/json/i)
    expect(retry.format).toEqual(SCHEMA)

    const result = lastResult(messages)
    if (result.subtype !== 'success') throw new Error(`получен ${result.subtype}`)
    expect(result.structured_output).toEqual(VALID)
    expect(result.num_turns).toBe(2)
  })

  it('JSON не по схеме — повтор, в сообщении об ошибке есть нарушенное поле', async () => {
    const fetchMock = scriptedOllama(
      ollamaReply(JSON.stringify({ summary: 'Обсудили релиз' })),
      ollamaReply(JSON.stringify(VALID)),
    )

    const messages = await collect(query({ prompt: 'Саммари', options: structuredOptions() }))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const feedback = requests(fetchMock)[1].messages.at(-1)
    expect(feedback?.role).toBe('user')
    expect(feedback?.content).toContain('decisions')
    const result = lastResult(messages)
    expect(result.subtype).toBe('success')
  })

  it('неверный тип поля — тоже нарушение схемы', async () => {
    const fetchMock = scriptedOllama(
      ollamaReply(JSON.stringify({ summary: 42, decisions: [] })),
      ollamaReply(JSON.stringify(VALID)),
    )

    const messages = await collect(query({ prompt: 'Саммари', options: structuredOptions() }))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(requests(fetchMock)[1].messages.at(-1)?.content).toContain('summary')
    expect(lastResult(messages).subtype).toBe('success')
  })

  it('невалидный ответ раз за разом — ограниченное число попыток, затем error_during_execution', async () => {
    const fetchMock = scriptedOllama(ollamaReply('не JSON'))

    const messages = await collect(query({ prompt: 'Саммари', options: structuredOptions() }))

    expect(fetchMock).toHaveBeenCalledTimes(MAX_ATTEMPTS)
    const result = lastResult(messages)
    expect(result.subtype).toBe('error_during_execution')
    if (result.subtype === 'success') return
    expect(result.is_error).toBe(true)
    expect(result.errors.join('\n')).toMatch(/schema|схем/i)
    expect(result).not.toHaveProperty('structured_output')
    expect(result.num_turns).toBe(MAX_ATTEMPTS)
  })

  it('каждая попытка отдаётся сообщением assistant', async () => {
    scriptedOllama(ollamaReply('не JSON'), ollamaReply('{"summary": 1}'), ollamaReply('{'))

    const messages = await collect(query({ prompt: 'Саммари', options: structuredOptions() }))

    expect(messages.map((message) => message.type)).toEqual([
      'system',
      'assistant',
      'assistant',
      'assistant',
      'result',
    ])
  })

  it('повторы не превышают maxTurns: исчерпание лимита — error_max_turns', async () => {
    const fetchMock = scriptedOllama(ollamaReply('не JSON'))

    const messages = await collect(
      query({ prompt: 'Саммари', options: structuredOptions({ maxTurns: 2 }) }),
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(lastResult(messages).subtype).toBe('error_max_turns')
  })

  it('повторы считаются заново для каждого сообщения пользователя', async () => {
    const fetchMock = scriptedOllama(
      ollamaReply('не JSON'),
      ollamaReply('не JSON'),
      ollamaReply(JSON.stringify(VALID)),
      ollamaReply('не JSON'),
      ollamaReply('не JSON'),
      ollamaReply(JSON.stringify(VALID)),
    )
    const messages = await collect(
      query({ prompt: userMessages('первое', 'второе'), options: structuredOptions() }),
    )

    expect(fetchMock).toHaveBeenCalledTimes(6)
    const results = messages.filter((message) => message.type === 'result')
    expect(results.map((result) => result.subtype)).toEqual(['success', 'success'])
  })
})

describe('outputFormat с инструментами', () => {
  it('запросы с инструментами идут без format, финальный ответ проверяется по схеме', async () => {
    const { server, handler } = meetingServer()
    const fetchMock = scriptedOllama(
      toolCallReply({ name: 'mcp__meeting__read_notes', arguments: {} }),
      ollamaReply(JSON.stringify(VALID)),
    )

    const messages = await collect(
      query({
        prompt: 'Саммари',
        options: structuredOptions({
          mcpServers: { meeting: server },
          allowedTools: ['mcp__meeting'],
        }),
      }),
    )

    expect(handler).toHaveBeenCalledTimes(1)
    const [first] = requests(fetchMock)
    // format ограничивает вывод грамматикой схемы и не даёт модели вызвать инструмент.
    expect(first.tools?.map((t) => t.function.name)).toEqual(['mcp__meeting__read_notes'])
    expect(first).not.toHaveProperty('format')
    const result = lastResult(messages)
    if (result.subtype !== 'success') throw new Error(`получен ${result.subtype}`)
    expect(result.structured_output).toEqual(VALID)
  })

  it('финальный ответ не по схеме — повтор с format и без инструментов', async () => {
    const { server } = meetingServer()
    const fetchMock = scriptedOllama(
      toolCallReply({ name: 'mcp__meeting__read_notes', arguments: {} }),
      ollamaReply('Обсудили релиз, решили выпустить в пятницу.'),
      ollamaReply(JSON.stringify(VALID)),
    )

    const messages = await collect(
      query({
        prompt: 'Саммари',
        options: structuredOptions({
          mcpServers: { meeting: server },
          allowedTools: ['mcp__meeting'],
        }),
      }),
    )

    expect(fetchMock).toHaveBeenCalledTimes(3)
    const retry = requests(fetchMock)[2]
    expect(retry.format).toEqual(SCHEMA)
    expect(retry).not.toHaveProperty('tools')
    // В истории повтора остаются вызов инструмента и его результат.
    expect(retry.messages.some((message) => message.role === 'tool')).toBe(true)
    const result = lastResult(messages)
    if (result.subtype !== 'success') throw new Error(`получен ${result.subtype}`)
    expect(result.structured_output).toEqual(VALID)
  })
})
