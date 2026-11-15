// Тестовый внешний MCP-сервер по stdio (в сборку не входит). Запуск:
//   node echo-mcp-server.mjs
// Переменные окружения (их передаёт `env` из конфига `mcpServers`):
// - ECHO_PREFIX — префикс ответа `echo` (по умолчанию `echo`);
// - ECHO_LOG — файл, в который `echo` дописывает каждый вызов: по нему тест проверяет, что
//   запрещённый инструмент не выполнялся;
// - ECHO_PID_FILE — файл, в который сервер пишет свой pid при старте: по нему тест проверяет, что
//   процесс завершается вместе с сессией;
// - ECHO_SECRET — ответ `get_secret` (для контрактного набора).
// Модули берутся из node_modules пакета `@video-meetings/llm-sdk`.
import { appendFileSync, writeFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

if (process.env.ECHO_PID_FILE) writeFileSync(process.env.ECHO_PID_FILE, String(process.pid))

const server = new McpServer({ name: 'echo-fixture', version: '1.0.0' })

server.registerTool(
  'echo',
  { description: 'Повторяет текст', inputSchema: { text: z.string().describe('Текст') } },
  async ({ text }) => {
    if (process.env.ECHO_LOG) appendFileSync(process.env.ECHO_LOG, `${text}\n`)
    return { content: [{ type: 'text', text: `${process.env.ECHO_PREFIX ?? 'echo'}: ${text}` }] }
  },
)

server.registerTool('fail', { description: 'Всегда возвращает ошибку' }, async () => ({
  content: [{ type: 'text', text: 'сломалось' }],
  isError: true,
}))

server.registerTool('get_secret', { description: 'Возвращает кодовое слово' }, async () => ({
  content: [{ type: 'text', text: process.env.ECHO_SECRET ?? 'нет кодового слова' }],
}))

await server.connect(new StdioServerTransport())
