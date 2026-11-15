import { fileURLToPath } from 'node:url'
import { provider, query } from '@video-meetings/llm'
import type { SDKMessage } from '@video-meetings/llm'

// Контрактный сценарий фазы 4 «внешний stdio-MCP-сервер»: одинаково проходит при
// LLM_PROVIDER=local (живая Ollama + Qwen) и LLM_PROVIDER=anthropic (Claude Agent SDK с
// ANTHROPIC_API_KEY). Сервер — фикстура llm-sdk (`ECHO_STDIO_SERVER` в
// llm-sdk/src/testing/mcp-servers.ts), её модули берутся из node_modules llm-sdk; процесс
// запускает SDK. Переносите фикстуру — поправьте путь здесь.

const SERVER = fileURLToPath(
  new URL('../../../llm-sdk/src/testing/fixtures/echo-mcp-server.mjs', import.meta.url),
)
// Кодовое слово модель узнать не может: оно есть только в ответе инструмента внешнего сервера.
const SECRET = 'PLUM-5803'
const TOOL = 'mcp__echo__get_secret'

describe.runIf(process.env.LLM_CONTRACT === '1')(`контракт: внешний MCP (${provider})`, () => {
  it('модель вызывает инструмент stdio-сервера и отвечает по его результату', async () => {
    const messages: SDKMessage[] = []
    for await (const message of query({
      prompt: 'Узнай кодовое слово с помощью инструмента get_secret и ответь только им.',
      options: {
        systemPrompt: 'Ты помощник. Кодовое слово можно узнать только инструментом get_secret.',
        // Отключает встроенные инструменты Claude Code (ФС, shell) в режиме anthropic
        tools: [],
        mcpServers: {
          echo: {
            type: 'stdio',
            command: process.execPath,
            args: [SERVER],
            env: { ECHO_SECRET: SECRET },
          },
        },
        allowedTools: [TOOL],
        maxTurns: 5,
      },
    })) {
      messages.push(message)
    }

    const init = messages[0]
    if (init.type !== 'system' || init.subtype !== 'init') throw new Error('нет system/init')
    // Claude Agent SDK подключает MCP-серверы не блокируя старт: в init статус может быть
    // `pending`, а инструментов сервера ещё нет. Локальный SDK подключается до init.
    expect(init.mcp_servers.map((server) => server.name)).toContain('echo')
    if (provider === 'local') {
      expect(init.mcp_servers).toContainEqual({ name: 'echo', status: 'connected' })
      expect(init.tools).toContain(TOOL)
    }

    const called = messages.some(
      (message) =>
        message.type === 'assistant' &&
        message.message.content.some((block) => block.type === 'tool_use' && block.name === TOOL),
    )
    expect(called).toBe(true)

    const result = messages.at(-1)
    if (result?.type !== 'result' || result.subtype !== 'success') throw new Error('нет success')
    expect(result.result).toContain(SECRET)
  })
})
