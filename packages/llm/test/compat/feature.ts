// Проверка совместимости типов: «код фичи», который импортирует только фасад.
// Файл проходит `tsc` дважды (`pnpm --filter @video-meetings/llm typecheck:compat`):
// - tsconfig.compat.local.json — `@video-meetings/llm` указывает на сам фасад (`src/index.ts`, локальный SDK);
// - tsconfig.compat.anthropic.json — на `@anthropic-ai/claude-agent-sdk`.
// Без `any` и приведений типов. Каждая SDK-фаза дописывает сюда свои возможности.
import { z } from 'zod'
import { AbortError, createSdkMcpServer, query, tool } from '@video-meetings/llm'
import type {
  CanUseTool,
  HookCallback,
  McpHttpServerConfig,
  McpServerConfig,
  McpSSEServerConfig,
  McpStdioServerConfig,
  Options,
  PermissionResult,
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
  SessionKey,
  SessionStore,
  SessionStoreEntry,
} from '@video-meetings/llm'

export interface SimpleAnswer {
  sessionId: string
  model: string
  tools: string[]
  texts: string[]
  result: string | null
  numTurns: number
  durationMs: number
  costUsd: number
  inputTokens: number
  outputTokens: number
}

export async function simpleAnswer(prompt: string | AsyncIterable<SDKUserMessage>) {
  const options: Options = {
    model: 'qwen3:14b',
    systemPrompt: 'Отвечай кратко.',
    // Отключает встроенные инструменты Claude Code (ФС, shell) в режиме anthropic
    tools: [],
  }
  const q: Query = query({ prompt, options })

  const answer: SimpleAnswer = {
    sessionId: '',
    model: '',
    tools: [],
    texts: [],
    result: null,
    numTurns: 0,
    durationMs: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
  }

  for await (const message of q) {
    handle(answer, message)
  }
  return answer
}

function handle(answer: SimpleAnswer, message: SDKMessage): void {
  if (message.type === 'system' && message.subtype === 'init') {
    answer.sessionId = message.session_id
    answer.model = message.model
    answer.tools = message.tools
  }
  if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text') answer.texts.push(block.text)
    }
  }
  if (message.type === 'result') handleResult(answer, message)
}

function handleResult(answer: SimpleAnswer, message: SDKResultMessage): void {
  answer.sessionId = message.session_id
  answer.numTurns = message.num_turns
  answer.durationMs = message.duration_ms
  answer.costUsd = message.total_cost_usd
  answer.inputTokens = message.usage.input_tokens
  answer.outputTokens = message.usage.output_tokens
  if (message.subtype === 'success') answer.result = message.result
}

export async function* userMessages(texts: string[]): AsyncIterable<SDKUserMessage> {
  for (const text of texts) {
    const message: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: '',
    }
    yield message
  }
}

export async function streamingAnswer(): Promise<SimpleAnswer> {
  return simpleAnswer(userMessages(['Привет']))
}

export async function interrupted(): Promise<void> {
  const q = query({ prompt: 'Привет' })
  await q.interrupt()
  await q.setPermissionMode('default')
}

// --- Фаза 2: SDK-инструменты, агентный цикл, права и хуки ---

const files = new Map([['f1', 'Протокол встречи: решили выпустить релиз в пятницу.']])

const readFile = tool(
  'read_file',
  'Читает часть файла встречи',
  { fileId: z.string(), offset: z.number().int().min(0), limit: z.number().int().positive() },
  async ({ fileId, offset, limit }) => {
    const text = files.get(fileId)
    if (text === undefined) {
      return { content: [{ type: 'text', text: `Нет файла ${fileId}` }], isError: true }
    }
    return { content: [{ type: 'text', text: text.slice(offset, offset + limit) }] }
  },
)

const listFiles = tool('list_files', 'Список файлов встречи', {}, async () => ({
  content: [{ type: 'text', text: JSON.stringify([...files.keys()]) }],
}))

const meetingServer = createSdkMcpServer({
  name: 'meeting',
  version: '1.0.0',
  tools: [listFiles, readFile],
})

const denyShell: HookCallback = async (input, toolUseID) => {
  if (input.hook_event_name !== 'PreToolUse') return {}
  if (input.tool_name.startsWith('mcp__meeting__')) {
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Инструмент ${input.tool_name} (${toolUseID ?? '-'}) запрещён`,
    },
  }
}

const limitRead: HookCallback = async (input) => {
  if (input.hook_event_name !== 'PreToolUse') return {}
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: { fileId: 'f1', offset: 0, limit: 100 },
    },
  }
}

const logEvent: HookCallback = async (input, _toolUseID, { signal }) => {
  if (signal.aborted) return {}
  switch (input.hook_event_name) {
    case 'PostToolUse':
      return { systemMessage: `${input.tool_name}: ${JSON.stringify(input.tool_response)}` }
    case 'UserPromptSubmit':
      return { systemMessage: input.prompt }
    case 'SessionStart':
      return { systemMessage: input.source }
    case 'SessionEnd':
      return { systemMessage: input.reason }
    case 'Stop':
      return { systemMessage: String(input.stop_hook_active) }
    default:
      return {}
  }
}

const onlyMeetingTools: CanUseTool = async (toolName, input, { signal }) => {
  const decision: PermissionResult =
    toolName.startsWith('mcp__meeting__') && !signal.aborted
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: `Инструмент ${toolName} запрещён` }
  return decision
}

export interface ToolAnswer {
  toolCalls: { id: string; name: string; input: unknown }[]
  toolResultIds: string[]
  result: string | null
  error: string | null
  denied: string[]
}

export async function toolAnswer(): Promise<ToolAnswer> {
  const options: Options = {
    systemPrompt: 'Ты делаешь саммари встречи по её файлам.',
    tools: [],
    mcpServers: { meeting: meetingServer },
    allowedTools: ['mcp__meeting__list_files', 'mcp__meeting__read_file'],
    disallowedTools: ['Bash'],
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    canUseTool: onlyMeetingTools,
    maxTurns: 10,
    hooks: {
      PreToolUse: [
        { hooks: [denyShell] },
        { matcher: 'mcp__meeting__read_file', hooks: [limitRead] },
      ],
      PostToolUse: [{ matcher: 'mcp__meeting__.*', hooks: [logEvent] }],
      UserPromptSubmit: [{ hooks: [logEvent] }],
      Stop: [{ hooks: [logEvent] }],
      SessionStart: [{ matcher: 'startup', hooks: [logEvent] }],
      SessionEnd: [{ hooks: [logEvent] }],
    },
  }

  const answer: ToolAnswer = {
    toolCalls: [],
    toolResultIds: [],
    result: null,
    error: null,
    denied: [],
  }
  for await (const message of query({ prompt: 'Сделай саммари встречи', options })) {
    switch (message.type) {
      case 'assistant':
        for (const block of message.message.content) {
          if (block.type === 'tool_use') {
            answer.toolCalls.push({ id: block.id, name: block.name, input: block.input })
          }
        }
        break
      case 'user': {
        const content = message.message.content
        if (typeof content === 'string') break
        for (const block of content) {
          if (block.type === 'tool_result') answer.toolResultIds.push(block.tool_use_id)
        }
        break
      }
      case 'result':
        answer.denied = message.permission_denials.map((denial) => denial.tool_name)
        if (message.subtype === 'success') answer.result = message.result
        else if (message.subtype === 'error_max_turns') answer.error = 'max turns'
        else answer.error = message.errors.join('; ')
        break
      default:
        break
    }
  }
  return answer
}

// --- Фаза 3: структурированный ответ, стриминг и отмена ---

export interface MeetingSummary {
  summary: string
  decisions: string[]
}

const summarySchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    decisions: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'decisions'],
  additionalProperties: false,
}

function isMeetingSummary(value: unknown): value is MeetingSummary {
  if (typeof value !== 'object' || value === null) return false
  if (!('summary' in value) || typeof value.summary !== 'string') return false
  return (
    'decisions' in value &&
    Array.isArray(value.decisions) &&
    value.decisions.every((item: unknown) => typeof item === 'string')
  )
}

/** `AbortError` фасада — и значение для `instanceof`, и тип. */
function isAbort(error: unknown): error is AbortError {
  return error instanceof AbortError
}

export interface StructuredAnswer {
  summary: MeetingSummary | null
  error: string | null
  partialText: string
  aborted: boolean
}

export async function structuredSummary(timeoutMs: number): Promise<StructuredAnswer> {
  const abortController = new AbortController()
  const timer = setTimeout(() => abortController.abort(), timeoutMs)
  const options: Options = {
    systemPrompt: 'Ты делаешь саммари встречи по её файлам.',
    tools: [],
    mcpServers: { meeting: meetingServer },
    allowedTools: ['mcp__meeting__list_files', 'mcp__meeting__read_file'],
    permissionMode: 'dontAsk',
    maxTurns: 10,
    abortController,
    includePartialMessages: true,
    outputFormat: { type: 'json_schema', schema: summarySchema },
  }

  const answer: StructuredAnswer = { summary: null, error: null, partialText: '', aborted: false }
  const q: Query = query({ prompt: 'Сделай саммари встречи', options })
  try {
    for await (const message of q) {
      switch (message.type) {
        case 'stream_event':
          if (
            message.event.type === 'content_block_delta' &&
            message.event.delta.type === 'text_delta'
          ) {
            answer.partialText += message.event.delta.text
          }
          break
        case 'result':
          if (message.subtype !== 'success') {
            answer.error = message.errors.join('; ')
          } else if (isMeetingSummary(message.structured_output)) {
            answer.summary = message.structured_output
          } else {
            answer.error = 'structured_output не по схеме'
          }
          break
        default:
          break
      }
    }
  } catch (error) {
    if (!isAbort(error)) throw error
    answer.aborted = true
  } finally {
    clearTimeout(timer)
  }
  return answer
}

// --- Фаза 4: сессии и внешние MCP-серверы ---

export interface SessionAnswer {
  sessionId: string
  result: string | null
}

async function answerIn(prompt: string, options: Options): Promise<SessionAnswer> {
  const answer: SessionAnswer = { sessionId: '', result: null }
  for await (const message of query({ prompt, options })) {
    if (message.type === 'result') {
      answer.sessionId = message.session_id
      if (message.subtype === 'success') answer.result = message.result
    }
  }
  return answer
}

/** Продолжение сессии по id, ответвление и продолжение последней сессии. */
export async function sessions(): Promise<SessionAnswer[]> {
  const base: Options = { systemPrompt: 'Отвечай кратко.', tools: [], maxTurns: 1 }
  const first = await answerIn('Запомни кодовое слово ЛИМОН-42', base)
  const resumed = await answerIn('Какое кодовое слово?', { ...base, resume: first.sessionId })
  const forked = await answerIn('Теперь кодовое слово ГРУША-7', {
    ...base,
    resume: first.sessionId,
    forkSession: true,
  })
  const continued = await answerIn('Какое кодовое слово?', { ...base, continue: true })
  return [first, resumed, forked, continued]
}

/** Своё хранилище сессий (например, в БД) — только через типы фасада. */
export function mapSessionStore(): SessionStore {
  const data = new Map<string, SessionStoreEntry[]>()
  const id = (key: SessionKey) => `${key.projectKey}/${key.sessionId}/${key.subpath ?? ''}`
  return {
    append: async (key, entries) => {
      data.set(id(key), [...(data.get(id(key)) ?? []), ...entries])
    },
    load: async (key) => data.get(id(key)) ?? null,
  }
}

export async function resumeFromStore(sessionId: string): Promise<SessionAnswer> {
  return answerIn('Продолжим', { tools: [], resume: sessionId, sessionStore: mapSessionStore() })
}

const stdioServer: McpStdioServerConfig = {
  type: 'stdio',
  command: process.execPath,
  args: ['echo-mcp-server.mjs'],
  env: { ECHO_SECRET: 'KIWI-7319' },
}

const httpServer: McpHttpServerConfig = {
  type: 'http',
  url: 'http://localhost:3002/mcp',
  headers: { Authorization: 'Bearer token' },
}

const sseServer: McpSSEServerConfig = { type: 'sse', url: 'http://localhost:3003/sse' }

/** Внешние MCP-серверы рядом с SDK-сервером: права и хуки — как у SDK-инструментов. */
export async function externalTools(): Promise<SessionAnswer> {
  const servers: Record<string, McpServerConfig> = {
    meeting: meetingServer,
    echo: stdioServer,
    remote: httpServer,
    legacy: sseServer,
  }
  return answerIn('Узнай кодовое слово инструментом get_secret', {
    tools: [],
    mcpServers: servers,
    allowedTools: ['mcp__echo__get_secret', 'mcp__remote'],
    disallowedTools: ['mcp__legacy__echo'],
    canUseTool: onlyMeetingTools,
    hooks: { PostToolUse: [{ matcher: 'mcp__echo__.*', hooks: [logEvent] }] },
    maxTurns: 5,
  })
}
