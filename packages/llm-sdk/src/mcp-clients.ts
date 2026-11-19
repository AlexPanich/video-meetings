// Внешние MCP-серверы из `options.mcpServers`: `stdio`, `http` (Streamable HTTP) и `sse`.
// Подключение при старте сессии, инструменты — как у SDK-серверов, отключение (и завершение
// процесса stdio-сервера) — вместе с сессией.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { RegisteredTool } from './tools.js'
import type {
  CallToolResult,
  McpHttpServerConfig,
  McpServerConfig,
  McpSSEServerConfig,
  McpStdioServerConfig,
} from './types.js'

type ExternalConfig = McpStdioServerConfig | McpHttpServerConfig | McpSSEServerConfig

/** Подключение и список инструментов дольше этого — сервер `failed`. */
const CONNECT_TIMEOUT_MS = 30_000

const CLIENT_INFO = { name: '@video-meetings/llm-sdk', version: '0.0.1' }

export function isExternal(config: McpServerConfig): config is ExternalConfig {
  return config.type !== 'sdk'
}

export interface ExternalServer {
  name: string
  status: 'connected' | 'failed'
  tools: RegisteredTool[]
}

/** Подключённые внешние серверы сессии; `close()` отключает все. */
export class ExternalServers {
  private readonly clients: Client[] = []

  constructor(readonly servers: ExternalServer[]) {}

  static async connect(
    servers: Record<string, McpServerConfig> = {},
    signal: AbortSignal,
  ): Promise<ExternalServers> {
    const result = new ExternalServers([])
    const entries = Object.entries(servers).filter((entry): entry is [string, ExternalConfig] =>
      isExternal(entry[1]),
    )
    // Серверы подключаются параллельно: сессия ждёт самый медленный, а не их сумму.
    const connected = await Promise.all(
      entries.map(([name, config]) => connectServer(name, config, signal)),
    )
    for (const item of connected) {
      if (item.client) result.clients.push(item.client)
      result.servers.push(item.server)
    }
    return result
  }

  /** Статус по имени сервера; не внешний — `undefined`. */
  status(name: string): ExternalServer['status'] | undefined {
    return this.servers.find((server) => server.name === name)?.status
  }

  tools(): RegisteredTool[] {
    return this.servers.flatMap((server) => server.tools)
  }

  /** Отключает клиентов; процесс stdio-сервера завершается (SIGTERM, затем SIGKILL). */
  async close(): Promise<void> {
    const clients = this.clients.splice(0)
    await Promise.allSettled(clients.map((client) => client.close()))
  }
}

async function connectServer(
  name: string,
  config: ExternalConfig,
  signal: AbortSignal,
): Promise<{ server: ExternalServer; client?: Client }> {
  const client = new Client(CLIENT_INFO)
  // Ошибки транспорта после подключения (сервер упал) — не исключение процесса: вызов
  // инструмента получит свою ошибку.
  client.onerror = () => undefined
  const timeout = AbortSignal.timeout(CONNECT_TIMEOUT_MS)
  const connectSignal = AbortSignal.any([signal, timeout])
  try {
    await client.connect(transport(config), { signal: connectSignal, timeout: CONNECT_TIMEOUT_MS })
    const tools: RegisteredTool[] = []
    let cursor: string | undefined
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined, {
        signal: connectSignal,
        timeout: CONNECT_TIMEOUT_MS,
      })
      for (const listed of page.tools) {
        tools.push(externalTool(client, name, config, listed))
      }
      cursor = page.nextCursor
    } while (cursor)
    return { server: { name, status: 'connected', tools }, client }
  } catch {
    // Процесс stdio-сервера мог запуститься и зависнуть: закрываем и его.
    await client.close().catch(() => undefined)
    return { server: { name, status: 'failed', tools: [] } }
  }
}

function transport(config: ExternalConfig): Transport {
  if (config.type === 'http') {
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers: config.headers },
    })
  }
  if (config.type === 'sse') {
    return new SSEClientTransport(new URL(config.url), {
      requestInit: { headers: config.headers },
    })
  }
  return new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env,
    // Вывод сервера в stderr не смешивается с выводом приложения.
    stderr: 'ignore',
  })
}

interface ListedTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean }
}

function externalTool(
  client: Client,
  server: string,
  config: ExternalConfig,
  listed: ListedTool,
): RegisteredTool {
  const parameters: Record<string, unknown> = { ...listed.inputSchema }
  delete parameters.$schema
  return {
    name: `mcp__${server}__${listed.name}`,
    server,
    description: listed.description ?? '',
    parameters,
    // Аргументы проверяет сам сервер: ошибка вернётся как результат с isError.
    validate: (input) => ({ success: true, data: input }),
    readOnly: listed.annotations?.readOnlyHint === true,
    handler: async (args, extra) => {
      const signal = signalOf(extra)
      const result = await client.callTool({ name: listed.name, arguments: args }, undefined, {
        signal,
        ...(config.timeout !== undefined ? { timeout: config.timeout } : {}),
      })
      return result as CallToolResult
    },
  }
}

function signalOf(extra: unknown): AbortSignal | undefined {
  if (typeof extra !== 'object' || extra === null || !('signal' in extra)) return undefined
  return extra.signal instanceof AbortSignal ? extra.signal : undefined
}
