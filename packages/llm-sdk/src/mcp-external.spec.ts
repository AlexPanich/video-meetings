// Тесты фазы 4: внешние MCP-серверы в `mcpServers` — `stdio` (процесс из фикстуры) и
// `http`/`sse` (сервер на localhost). Их инструменты подчиняются тем же правам и хукам, что и
// SDK-инструменты. Транспорт Ollama подменяется мок-`fetch`, запросы к MCP по http/sse идут в
// настоящий `fetch`.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { AbortError, createSdkMcpServer, query, tool } from './index.js'
import type {
  HookInput,
  McpServerConfig,
  Options,
  SDKMessage,
  SDKSystemMessage,
  SDKUserMessage,
} from './index.js'
import { ECHO_STDIO_SERVER, startHttpMcpServer, startSseMcpServer } from './testing/mcp-servers.js'
import type { TestMcpServer } from './testing/mcp-servers.js'
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

const ECHO = 'mcp__echo__echo'

let dir: string

beforeEach(() => {
  stubOllamaEnv()
  dir = mkdtempSync(join(tmpdir(), 'llm-sdk-mcp-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** stdio-сервер из фикстуры; `ECHO_LOG` — файл с вызовами `echo`. */
function stdioServer(env: Record<string, string> = {}): McpServerConfig {
  return {
    type: 'stdio',
    command: process.execPath,
    args: [ECHO_STDIO_SERVER],
    env: { ECHO_LOG: join(dir, 'calls.log'), ...env },
  }
}

function echoCalls(): string[] {
  const log = join(dir, 'calls.log')
  if (!existsSync(log)) return []
  return readFileSync(log, 'utf8').split('\n').filter(Boolean)
}

function init(messages: SDKMessage[]): SDKSystemMessage {
  const first = messages[0]
  if (first?.type !== 'system') throw new Error(`первое сообщение — ${first?.type}`)
  return first
}

function toolResults(messages: SDKMessage[]) {
  return messages
    .filter((message): message is SDKUserMessage => message.type === 'user')
    .flatMap((message) =>
      typeof message.message.content === 'string' ? [] : message.message.content,
    )
    .filter((block) => block.type === 'tool_result')
}

function resultText(block: ReturnType<typeof toolResults>[number]): string {
  const content = block.content
  if (typeof content === 'string') return content
  return (content ?? []).map((part) => (part.type === 'text' ? part.text : '')).join('')
}

async function runEcho(options: Options, text = 'привет'): Promise<SDKMessage[]> {
  scriptedOllama(toolCallReply({ name: ECHO, arguments: { text } }), ollamaReply('Готово'))
  return collect(query({ prompt: 'Повтори', options }))
}

/** Ждёт, пока процесс с pid из файла завершится (`ESRCH` — такого процесса нет). */
async function expectExited(pidFile: string): Promise<void> {
  await vi.waitFor(() => expect(existsSync(pidFile)).toBe(true), { timeout: 5000 })
  const pid = Number(readFileSync(pidFile, 'utf8'))
  expect(Number.isInteger(pid) && pid > 0).toBe(true)
  await vi.waitFor(
    () => expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' })),
    { timeout: 8000 },
  )
}

// Каждый тест запускает процесс node с MCP SDK: запас времени на нагруженной машине (pre-commit).
describe('внешний MCP-сервер по stdio', { timeout: 20_000 }, () => {
  it('инструменты сервера уходят модели и видны в system/init', async () => {
    const fetchMock = scriptedOllama(ollamaReply('Ок'))

    const messages = await collect(
      query({ prompt: 'Привет', options: { mcpServers: { echo: stdioServer() } } }),
    )

    const system = init(messages)
    expect(system.tools).toEqual(expect.arrayContaining([ECHO, 'mcp__echo__fail']))
    expect(system.mcp_servers).toEqual([{ name: 'echo', status: 'connected' }])
    const offered = requests(fetchMock)[0].tools ?? []
    const echo = offered.find((item) => item.function.name === ECHO)
    expect(echo).toMatchObject({
      type: 'function',
      function: {
        name: ECHO,
        description: 'Повторяет текст',
        parameters: { type: 'object', properties: { text: { type: 'string' } } },
      },
    })
  })

  it('вызов инструмента: результат сервера уходит модели', async () => {
    const messages = await runEcho({
      mcpServers: { echo: stdioServer({ ECHO_PREFIX: 'эхо' }) },
      allowedTools: [ECHO],
    })

    expect(echoCalls()).toEqual(['привет'])
    const [block] = toolResults(messages)
    expect(block).toMatchObject({ type: 'tool_result', is_error: false })
    // env из конфига дошёл до процесса сервера.
    expect(resultText(block)).toBe('эхо: привет')
    expect(lastResult(messages).subtype).toBe('success')
  })

  it('история следующего запроса содержит результат инструмента', async () => {
    const fetchMock = scriptedOllama(
      toolCallReply({ name: ECHO, arguments: { text: 'раз' } }),
      ollamaReply('Готово'),
    )

    await collect(
      query({
        prompt: 'Повтори',
        options: { mcpServers: { echo: stdioServer() }, allowedTools: ['mcp__echo'] },
      }),
    )

    const last = requests(fetchMock)[1].messages.at(-1)
    expect(last).toMatchObject({ role: 'tool', content: 'echo: раз', tool_name: ECHO })
  })

  it('isError от сервера — tool_result с is_error', async () => {
    scriptedOllama(toolCallReply({ name: 'mcp__echo__fail', arguments: {} }), ollamaReply('Увы'))

    const messages = await collect(
      query({
        prompt: 'Сломай',
        options: { mcpServers: { echo: stdioServer() }, allowedTools: ['mcp__echo'] },
      }),
    )

    const [block] = toolResults(messages)
    expect(block).toMatchObject({ is_error: true })
    expect(resultText(block)).toContain('сломалось')
  })

  it('без allowedTools и canUseTool вызов отклоняется и не выполняется', async () => {
    const messages = await runEcho({ mcpServers: { echo: stdioServer() } })

    expect(echoCalls()).toEqual([])
    expect(toolResults(messages)[0]).toMatchObject({ is_error: true })
    expect(lastResult(messages).permission_denials).toEqual([
      expect.objectContaining({ tool_name: ECHO, tool_input: { text: 'привет' } }),
    ])
  })

  it('canUseTool решает за инструмент и может заменить ввод', async () => {
    const asked: [string, Record<string, unknown>][] = []

    await runEcho({
      mcpServers: { echo: stdioServer() },
      canUseTool: async (name, input) => {
        asked.push([name, input])
        return { behavior: 'allow', updatedInput: { text: 'заменено' } }
      },
    })

    expect(asked).toEqual([[ECHO, { text: 'привет' }]])
    expect(echoCalls()).toEqual(['заменено'])
  })

  it('canUseTool с deny блокирует инструмент', async () => {
    const messages = await runEcho({
      mcpServers: { echo: stdioServer() },
      canUseTool: async () => ({ behavior: 'deny', message: 'Нельзя' }),
    })

    expect(echoCalls()).toEqual([])
    expect(resultText(toolResults(messages)[0])).toContain('Нельзя')
  })

  it('disallowedTools убирает инструмент из запроса к модели', async () => {
    const fetchMock = scriptedOllama(ollamaReply('Ок'))

    const messages = await collect(
      query({
        prompt: 'Привет',
        options: { mcpServers: { echo: stdioServer() }, disallowedTools: [ECHO] },
      }),
    )

    const names = (requests(fetchMock)[0].tools ?? []).map((item) => item.function.name)
    expect(names).not.toContain(ECHO)
    expect(names).toContain('mcp__echo__fail')
    expect(init(messages).tools).not.toContain(ECHO)
  })

  it('PreToolUse с deny блокирует инструмент, PostToolUse получает ответ сервера', async () => {
    const pre: HookInput[] = []
    const post: HookInput[] = []

    await runEcho({
      mcpServers: { echo: stdioServer() },
      allowedTools: [ECHO],
      hooks: {
        PreToolUse: [
          {
            matcher: ECHO,
            hooks: [
              async (input) => {
                pre.push(input)
                return {}
              },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: ECHO,
            hooks: [
              async (input) => {
                post.push(input)
                return {}
              },
            ],
          },
        ],
      },
    })

    expect(pre).toEqual([
      expect.objectContaining({ tool_name: ECHO, tool_input: { text: 'привет' } }),
    ])
    expect(post).toHaveLength(1)
    expect(post[0]).toMatchObject({
      tool_name: ECHO,
      tool_response: { content: [{ type: 'text', text: 'echo: привет' }] },
    })

    const messages = await runEcho({
      mcpServers: { echo: stdioServer() },
      allowedTools: [ECHO],
      hooks: {
        PreToolUse: [
          {
            matcher: 'mcp__echo__.*',
            hooks: [
              async () => ({
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse',
                  permissionDecision: 'deny',
                  permissionDecisionReason: 'Хук запретил',
                },
              }),
            ],
          },
        ],
      },
    })
    expect(echoCalls()).toEqual(['привет'])
    expect(resultText(toolResults(messages)[0])).toContain('Хук запретил')
  })

  it('рядом с SDK-сервером: доступны инструменты обоих', async () => {
    const local = createSdkMcpServer({
      name: 'kv',
      tools: [
        tool('get', 'Значение', { key: z.string() }, async () => ({
          content: [{ type: 'text', text: '1' }],
        })),
      ],
    })
    const fetchMock = scriptedOllama(ollamaReply('Ок'))

    await collect(
      query({ prompt: 'Привет', options: { mcpServers: { kv: local, echo: stdioServer() } } }),
    )

    const names = (requests(fetchMock)[0].tools ?? []).map((item) => item.function.name)
    expect(names).toEqual(expect.arrayContaining(['mcp__kv__get', ECHO]))
  })

  describe('процесс сервера завершается вместе с сессией', () => {
    it('после result', async () => {
      const pidFile = join(dir, 'server.pid')
      scriptedOllama(ollamaReply('Ок'))

      await collect(
        query({
          prompt: 'Привет',
          options: { mcpServers: { echo: stdioServer({ ECHO_PID_FILE: pidFile }) } },
        }),
      )

      await expectExited(pidFile)
    })

    it('когда вызывающий код вышел из цикла (break)', async () => {
      const pidFile = join(dir, 'server.pid')
      scriptedOllama(ollamaReply('Ок'))

      for await (const message of query({
        prompt: 'Привет',
        options: { mcpServers: { echo: stdioServer({ ECHO_PID_FILE: pidFile }) } },
      })) {
        if (message.type === 'system') break
      }

      await expectExited(pidFile)
    })

    it('после interrupt()', async () => {
      const pidFile = join(dir, 'server.pid')
      hangingOllama()
      const q = query({
        prompt: 'Привет',
        options: { mcpServers: { echo: stdioServer({ ECHO_PID_FILE: pidFile }) } },
      })

      const first = await q.next()
      expect(first.value?.type).toBe('system')
      const rest = collect(q)
      await q.interrupt()
      await rest

      await expectExited(pidFile)
    })

    it('после отмены через abortController', async () => {
      const pidFile = join(dir, 'server.pid')
      hangingOllama()
      const abortController = new AbortController()
      const q = query({
        prompt: 'Привет',
        options: {
          abortController,
          mcpServers: { echo: stdioServer({ ECHO_PID_FILE: pidFile }) },
        },
      })

      await q.next()
      const rest = collect(q)
      abortController.abort()
      await expect(rest).rejects.toBeInstanceOf(AbortError)

      await expectExited(pidFile)
    })

    it('после ошибки Ollama', async () => {
      const pidFile = join(dir, 'server.pid')
      scriptedOllama(new Response('сломалось', { status: 500 }))

      await expect(
        collect(
          query({
            prompt: 'Привет',
            options: { mcpServers: { echo: stdioServer({ ECHO_PID_FILE: pidFile }) } },
          }),
        ),
      ).rejects.toThrow()

      await expectExited(pidFile)
    })
  })

  it('сервер не запустился: status failed, сессия идёт без его инструментов', async () => {
    const fetchMock = scriptedOllama(ollamaReply('Ок'))

    const messages = await collect(
      query({
        prompt: 'Привет',
        options: {
          mcpServers: {
            broken: { type: 'stdio', command: join(dir, 'нет-такой-программы') },
          },
        },
      }),
    )

    expect(init(messages).mcp_servers).toEqual([{ name: 'broken', status: 'failed' }])
    expect(requests(fetchMock)[0].tools ?? []).toEqual([])
    expect(lastResult(messages).subtype).toBe('success')
  })

  it('type можно не указывать: по умолчанию stdio', async () => {
    const messages = await runEcho({
      mcpServers: { echo: { command: process.execPath, args: [ECHO_STDIO_SERVER] } },
      allowedTools: [ECHO],
    })

    expect(resultText(toolResults(messages)[0])).toBe('echo: привет')
  })
})

describe.each([
  ['http', startHttpMcpServer],
  ['sse', startSseMcpServer],
] as const)('внешний MCP-сервер по %s', { timeout: 20_000 }, (type, start) => {
  let server: TestMcpServer

  beforeEach(async () => {
    server = await start()
  })

  afterEach(async () => {
    await server.close()
  })

  it('инструмент вызывается, результат уходит модели', async () => {
    const messages = await runEcho({
      mcpServers: { echo: { type, url: server.url } },
      allowedTools: [ECHO],
    })

    expect(init(messages).mcp_servers).toEqual([{ name: 'echo', status: 'connected' }])
    expect(init(messages).tools).toContain(ECHO)
    expect(server.calls).toEqual(['привет'])
    expect(resultText(toolResults(messages)[0])).toBe('echo: привет')
  })

  it('заголовки из конфига уходят серверу', async () => {
    await runEcho({
      mcpServers: {
        echo: { type, url: server.url, headers: { Authorization: 'Bearer test-token' } },
      },
      allowedTools: [ECHO],
    })

    expect(server.headers.length).toBeGreaterThan(0)
    expect(server.headers.every((headers) => headers.authorization === 'Bearer test-token')).toBe(
      true,
    )
  })

  it('права действуют так же: без разрешения сервер не вызывается', async () => {
    const messages = await runEcho({ mcpServers: { echo: { type, url: server.url } } })

    expect(server.calls).toEqual([])
    expect(lastResult(messages).permission_denials.map((denial) => denial.tool_name)).toEqual([
      ECHO,
    ])
  })

  it('недоступный сервер: status failed, сессия продолжается', async () => {
    const url = server.url
    await server.close()
    scriptedOllama(ollamaReply('Ок'))

    const messages = await collect(
      query({ prompt: 'Привет', options: { mcpServers: { echo: { type, url } } } }),
    )

    expect(init(messages).mcp_servers).toEqual([{ name: 'echo', status: 'failed' }])
    expect(lastResult(messages).subtype).toBe('success')
  })
})
