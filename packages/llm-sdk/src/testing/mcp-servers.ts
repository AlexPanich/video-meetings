// Тестовые внешние MCP-серверы для unit-тестов (в сборку не входят). stdio-сервер — отдельный
// процесс из `fixtures/echo-mcp-server.mjs`; http (Streamable HTTP) и sse поднимаются здесь же на
// localhost со случайным портом. Мок Ollama пропускает запросы к ним в настоящий `fetch`.
import { createServer } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

/** Путь к stdio-серверу: `command: process.execPath, args: [ECHO_STDIO_SERVER]`. */
export const ECHO_STDIO_SERVER = fileURLToPath(
  new URL('./fixtures/echo-mcp-server.mjs', import.meta.url),
)

export interface TestMcpServer {
  /** `http://127.0.0.1:<port>/mcp` для `http`, `http://127.0.0.1:<port>/sse` для `sse`. */
  url: string
  /** Аргументы каждого вызова `echo`. */
  calls: string[]
  /** Заголовки всех HTTP-запросов к серверу. */
  headers: IncomingHttpHeaders[]
  /** Останавливает сервер; повторный вызов ничего не делает. */
  close(): Promise<void>
}

/**
 * MCP-сервер с инструментами `echo` и `fail`, как у stdio-фикстуры (без её переменных окружения
 * и `get_secret`: вызовы видны в `calls`, а не в файле). Меняете ответы — меняйте и фикстуру.
 */
function echoServer(calls: string[]): McpServer {
  const server = new McpServer({ name: 'echo-fixture', version: '1.0.0' })
  server.registerTool(
    'echo',
    { description: 'Повторяет текст', inputSchema: { text: z.string().describe('Текст') } },
    async ({ text }) => {
      calls.push(text)
      return { content: [{ type: 'text', text: `echo: ${text}` }] }
    },
  )
  server.registerTool('fail', { description: 'Всегда возвращает ошибку' }, async () => ({
    content: [{ type: 'text', text: 'сломалось' }],
    isError: true,
  }))
  return server
}

async function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  path: string,
  calls: string[],
  headers: IncomingHttpHeaders[],
): Promise<TestMcpServer> {
  const http = createServer((req, res) => {
    headers.push(req.headers)
    handler(req, res).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500)
      res.end(String(error))
    })
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  const { port } = http.address() as AddressInfo
  let closed: Promise<void> | undefined
  return {
    url: `http://127.0.0.1:${port}${path}`,
    calls,
    headers,
    close: () =>
      (closed ??= new Promise<void>((resolve) => {
        // Сначала перестаём принимать соединения, потом рвём открытые (потоки SSE).
        http.close(() => resolve())
        http.closeAllConnections()
      })),
  }
}

/** Streamable HTTP без состояния: на каждый запрос — свой сервер и транспорт. */
export function startHttpMcpServer(): Promise<TestMcpServer> {
  const calls: string[] = []
  const headers: IncomingHttpHeaders[] = []
  return listen(
    async (req, res) => {
      if (!req.url?.startsWith('/mcp')) {
        res.writeHead(404).end()
        return
      }
      const server = echoServer(calls)
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      // server.close() закрывает и транспорт.
      res.on('close', () => void server.close())
      await server.connect(transport)
      await transport.handleRequest(req, res)
    },
    '/mcp',
    calls,
    headers,
  )
}

/** Старый транспорт SSE: `GET /sse` открывает поток, `POST /messages?sessionId=…` — сообщения. */
export function startSseMcpServer(): Promise<TestMcpServer> {
  const calls: string[] = []
  const headers: IncomingHttpHeaders[] = []
  const transports = new Map<string, SSEServerTransport>()
  return listen(
    async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method === 'GET' && url.pathname === '/sse') {
        const transport = new SSEServerTransport('/messages', res)
        transports.set(transport.sessionId, transport)
        res.on('close', () => transports.delete(transport.sessionId))
        await echoServer(calls).connect(transport)
        return
      }
      const transport = transports.get(url.searchParams.get('sessionId') ?? '')
      if (req.method === 'POST' && url.pathname === '/messages' && transport) {
        await transport.handlePostMessage(req, res)
        return
      }
      res.writeHead(404).end()
    },
    '/sse',
    calls,
    headers,
  )
}
