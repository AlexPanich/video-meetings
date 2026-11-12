// Проверка совместимости типов: «код фичи», который импортирует только фасад.
// Файл проходит `tsc` дважды (`pnpm --filter @video-meetings/llm typecheck:compat`):
// - tsconfig.compat.local.json — `@video-meetings/llm` указывает на сам фасад (`src/index.ts`, локальный SDK);
// - tsconfig.compat.anthropic.json — на `@anthropic-ai/claude-agent-sdk`.
// Без `any` и приведений типов. Каждая SDK-фаза дописывает сюда свои возможности.
import { z } from 'zod'
import { createSdkMcpServer, query, tool } from '@video-meetings/llm'
import type {
  CanUseTool,
  HookCallback,
  Options,
  PermissionResult,
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
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
