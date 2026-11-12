import { createSdkMcpServer, provider, query, tool } from '@video-meetings/llm'
import type { Options, SDKMessage } from '@video-meetings/llm'

// Контрактные сценарии фазы 2: вызов SDK-инструмента, error_max_turns, deny в PreToolUse и в
// canUseTool. Одинаково проходят при LLM_PROVIDER=local (живая Ollama + Qwen) и
// LLM_PROVIDER=anthropic (Claude Agent SDK с ANTHROPIC_API_KEY).

// Кодовое слово модель узнать не может: оно есть только в ответе инструмента.
const SECRET = 'KIWI-7319'
const TOOL = 'mcp__vault__get_secret'
const PROMPT =
  'Узнай кодовое слово с помощью инструмента get_secret и ответь только им, без пояснений.'
const SYSTEM_PROMPT =
  'Ты помощник. Кодовое слово можно узнать только инструментом get_secret. ' +
  'Если инструмент недоступен или вернул отказ, ответь словом «отказ».'

function vault() {
  const calls = { count: 0 }
  const getSecret = tool('get_secret', 'Возвращает кодовое слово', {}, async () => {
    calls.count += 1
    return { content: [{ type: 'text', text: SECRET }] }
  })
  const server = createSdkMcpServer({ name: 'vault', version: '1.0.0', tools: [getSecret] })
  return { server, calls }
}

function baseOptions(server: ReturnType<typeof vault>['server']): Options {
  return {
    systemPrompt: SYSTEM_PROMPT,
    // Отключает встроенные инструменты Claude Code (ФС, shell) в режиме anthropic
    tools: [],
    mcpServers: { vault: server },
    maxTurns: 5,
  }
}

async function run(options: Options): Promise<SDKMessage[]> {
  const messages: SDKMessage[] = []
  for await (const message of query({ prompt: PROMPT, options })) messages.push(message)
  return messages
}

function toolUseNames(messages: SDKMessage[]): string[] {
  const names: string[] = []
  for (const message of messages) {
    if (message.type !== 'assistant') continue
    for (const block of message.message.content) {
      if (block.type === 'tool_use') names.push(block.name)
    }
  }
  return names
}

function toolResultCount(messages: SDKMessage[]): number {
  let count = 0
  for (const message of messages) {
    if (message.type !== 'user') continue
    const content = message.message.content
    if (typeof content === 'string') continue
    for (const block of content) if (block.type === 'tool_result') count += 1
  }
  return count
}

function finalResult(messages: SDKMessage[]) {
  const result = messages.at(-1)
  if (result?.type !== 'result') throw new Error('последнее сообщение — не result')
  return result
}

describe.runIf(process.env.LLM_CONTRACT === '1')(`контракт: инструменты (${provider})`, () => {
  it('модель вызывает SDK-инструмент и отвечает по его результату', async () => {
    const { server, calls } = vault()

    const messages = await run({ ...baseOptions(server), allowedTools: [TOOL] })

    const init = messages[0]
    if (init.type !== 'system' || init.subtype !== 'init') throw new Error('нет system/init')
    expect(init.tools).toContain(TOOL)
    expect(toolUseNames(messages)).toContain(TOOL)
    expect(toolResultCount(messages)).toBeGreaterThanOrEqual(1)
    expect(calls.count).toBeGreaterThanOrEqual(1)

    const result = finalResult(messages)
    if (result.subtype !== 'success') throw new Error(`ожидался success, получен ${result.subtype}`)
    expect(result.result).toContain(SECRET)
    expect(result.num_turns).toBeGreaterThanOrEqual(2)
  })

  it('maxTurns: 1 при вызове инструмента даёт error_max_turns', async () => {
    const { server } = vault()

    const messages = await run({ ...baseOptions(server), allowedTools: [TOOL], maxTurns: 1 })

    const result = finalResult(messages)
    expect(result.subtype).toBe('error_max_turns')
    expect(result.is_error).toBe(true)
  })

  it('PreToolUse с deny блокирует инструмент', async () => {
    const { server, calls } = vault()
    const denied: string[] = []

    const messages = await run({
      ...baseOptions(server),
      allowedTools: [TOOL],
      hooks: {
        PreToolUse: [
          {
            matcher: TOOL,
            hooks: [
              async (input) => {
                if (input.hook_event_name === 'PreToolUse') denied.push(input.tool_name)
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: 'deny',
                    permissionDecisionReason: 'Доступ к хранилищу запрещён',
                  },
                }
              },
            ],
          },
        ],
      },
    })

    expect(denied).toContain(TOOL)
    expect(calls.count).toBe(0)
    const result = finalResult(messages)
    if (result.subtype === 'success') expect(result.result).not.toContain(SECRET)
  })

  it('canUseTool с deny блокирует инструмент', async () => {
    const { server, calls } = vault()
    const asked: string[] = []

    const messages = await run({
      ...baseOptions(server),
      // Без allowedTools решение по инструменту принимает canUseTool.
      permissionMode: 'default',
      canUseTool: async (toolName) => {
        asked.push(toolName)
        return { behavior: 'deny', message: 'Доступ к хранилищу запрещён' }
      },
    })

    expect(asked).toContain(TOOL)
    expect(calls.count).toBe(0)
    const result = finalResult(messages)
    expect(result.permission_denials.map((denial) => denial.tool_name)).toContain(TOOL)
    if (result.subtype === 'success') expect(result.result).not.toContain(SECRET)
  })
})
