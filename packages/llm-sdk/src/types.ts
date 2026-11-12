// Публичные типы, повторяющие `@anthropic-ai/claude-agent-sdk` (опорная версия — в devDependencies
// package.json). Описано подмножество, которое реализует SDK: имена и формы полей совпадают с
// оригиналом, чтобы код фич компилировался с обеими реализациями (см. packages/llm/test/compat).
import type { UUID } from 'node:crypto'

export type PermissionMode =
  'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'

/** Блок текста в сообщении (как `TextBlockParam`/`BetaTextBlock` Messages API). */
export interface TextBlock {
  type: 'text'
  text: string
}

export type ContentBlock = TextBlock

/** Сообщение пользователя в формате Messages API (`MessageParam` с ролью `user`). */
export interface UserMessageParam {
  role: 'user'
  content: string | ContentBlock[]
}

export interface Usage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

/** Ответ модели (подмножество `BetaMessage`). */
export interface AssistantMessage {
  id: string
  type: 'message'
  role: 'assistant'
  model: string
  content: ContentBlock[]
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null
  stop_sequence: string | null
  usage: Usage
}

export interface ModelUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  webSearchRequests: number
  costUSD: number
  contextWindow: number
  maxOutputTokens: number
}

export interface SDKPermissionDenial {
  tool_name: string
  tool_use_id: string
  tool_input: Record<string, unknown>
}

export interface SDKSystemMessage {
  type: 'system'
  subtype: 'init'
  cwd: string
  tools: string[]
  mcp_servers: { name: string; status: string }[]
  model: string
  permissionMode: PermissionMode
  uuid: UUID
  session_id: string
}

export interface SDKUserMessage {
  type: 'user'
  message: UserMessageParam
  parent_tool_use_id: string | null
  uuid?: UUID
  session_id: string
}

export interface SDKAssistantMessage {
  type: 'assistant'
  message: AssistantMessage
  parent_tool_use_id: string | null
  uuid: UUID
  session_id: string
}

interface SDKResultBase {
  type: 'result'
  duration_ms: number
  duration_api_ms: number
  is_error: boolean
  num_turns: number
  stop_reason: string | null
  total_cost_usd: number
  usage: Usage
  modelUsage: Record<string, ModelUsage>
  permission_denials: SDKPermissionDenial[]
  uuid: UUID
  session_id: string
}

export interface SDKResultSuccess extends SDKResultBase {
  subtype: 'success'
  result: string
}

export interface SDKResultError extends SDKResultBase {
  subtype:
    | 'error_during_execution'
    | 'error_max_turns'
    | 'error_max_budget_usd'
    | 'error_max_structured_output_retries'
  errors: string[]
}

export type SDKResultMessage = SDKResultSuccess | SDKResultError

export type SDKMessage = SDKSystemMessage | SDKUserMessage | SDKAssistantMessage | SDKResultMessage

/**
 * Опции `query()`. Фаза 1 использует `model`, `systemPrompt` и `permissionMode`;
 * `maxTurns`, `allowedTools` и `disallowedTools` принимаются для совместимости и вступают в силу
 * вместе с инструментами (без инструментов один ход не может их нарушить).
 */
export interface Options {
  /** Модель Ollama, перекрывает `OLLAMA_MODEL`. */
  model?: string
  /** Системный промпт; массив склеивается через пустую строку. */
  systemPrompt?: string | string[]
  maxTurns?: number
  allowedTools?: string[]
  disallowedTools?: string[]
  permissionMode?: PermissionMode
}

export interface Query extends AsyncGenerator<SDKMessage, void> {
  /** Прерывает текущий запрос к модели; генератор завершается без ошибки. */
  interrupt(): Promise<void>
  setPermissionMode(mode: PermissionMode): Promise<void>
}
