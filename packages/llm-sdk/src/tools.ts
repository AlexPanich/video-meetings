// SDK-инструменты: `tool()`, `createSdkMcpServer()` и их представление для агентного цикла.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type {
  AnyZodRawShape,
  CallToolResult,
  CreateSdkMcpServerOptions,
  InferShape,
  McpServerConfig,
  McpSdkServerConfigWithInstance,
  SdkMcpToolDefinition,
  ToolAnnotations,
} from './types.js'

/** Определяет инструмент SDK-сервера: имя, описание, zod-форма аргументов и обработчик. */
export function tool<Schema extends AnyZodRawShape>(
  name: string,
  description: string,
  inputSchema: Schema,
  handler: (args: InferShape<Schema>, extra: unknown) => Promise<CallToolResult>,
  extras?: { annotations?: ToolAnnotations; searchHint?: string; alwaysLoad?: boolean },
): SdkMcpToolDefinition<Schema> {
  return { name, description, inputSchema, handler, annotations: extras?.annotations }
}

/** Инструмент сервера, подготовленный один раз при создании сервера. */
interface CompiledTool {
  name: string
  description: string
  /** JSON Schema аргументов для tool calling Ollama. */
  parameters: Record<string, unknown>
  schema: z.ZodType<Record<string, unknown>>
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult>
}

/** Инструменты серверов, созданных этим пакетом (по экземпляру `McpServer`). */
const serverTools = new WeakMap<McpServer, CompiledTool[]>()

/**
 * Создаёт in-process MCP-сервер для `options.mcpServers`. Как и в оригинале, в конфиге — живой
 * `McpServer` с зарегистрированными инструментами; локальный агентный цикл вызывает обработчики
 * напрямую, без MCP-транспорта. Схема поля, которую нельзя выразить в JSON Schema (`z.date()`,
 * `transform`), уходит модели как произвольное значение, а аргументы всё равно проверяет zod.
 */
export function createSdkMcpServer(
  options: CreateSdkMcpServerOptions,
): McpSdkServerConfigWithInstance {
  const instance = new McpServer({ name: options.name, version: options.version ?? '1.0.0' })
  const definitions = (options.tools ?? []) as SdkMcpToolDefinition[]
  const compiled: CompiledTool[] = []
  for (const definition of definitions) {
    const shape = zodShape(definition)
    instance.registerTool(
      definition.name,
      {
        description: definition.description,
        inputSchema: shape,
        annotations: definition.annotations,
      },
      // Обработчик уже принимает разобранные по схеме аргументы.
      (args: Record<string, unknown>, extra: unknown) =>
        definition.handler(args as InferShape<AnyZodRawShape>, extra),
    )
    const schema = z.object(shape)
    const parameters = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<
      string,
      unknown
    >
    delete parameters.$schema
    compiled.push({
      name: definition.name,
      description: definition.description,
      parameters,
      schema,
      handler: definition.handler,
    })
  }
  serverTools.set(instance, compiled)
  return { type: 'sdk', name: options.name, instance }
}

/** Инструмент, готовый к вызову из агентного цикла. */
export interface RegisteredTool extends CompiledTool {
  /** `mcp__<server>__<tool>`. */
  name: string
  server: string
}

/** Собирает инструменты всех серверов `options.mcpServers`; ключ записи — имя сервера. */
export function registerTools(servers: Record<string, McpServerConfig> = {}): RegisteredTool[] {
  const registered: RegisteredTool[] = []
  for (const [server, config] of Object.entries(servers)) {
    const tools = config.type === 'sdk' ? serverTools.get(config.instance) : undefined
    if (!tools) {
      throw new Error(
        `MCP server "${server}" is not supported by the local SDK: only servers from createSdkMcpServer() of @video-meetings/llm-sdk`,
      )
    }
    for (const compiled of tools) {
      registered.push({ ...compiled, name: `mcp__${server}__${compiled.name}`, server })
    }
  }
  return registered
}

/** Форма схемы как zod 4: схемы zod 3 локально не поддерживаются. */
function zodShape(definition: SdkMcpToolDefinition): z.ZodRawShape {
  for (const [field, schema] of Object.entries(definition.inputSchema)) {
    // У схем zod 4 есть внутреннее поле `_zod` (и у копий zod из других пакетов).
    if (typeof schema !== 'object' || schema === null || !('_zod' in schema)) {
      throw new Error(
        `Tool "${definition.name}": field "${field}" is not a zod 4 schema (zod 3 is not supported by the local SDK)`,
      )
    }
  }
  return definition.inputSchema as z.ZodRawShape
}
