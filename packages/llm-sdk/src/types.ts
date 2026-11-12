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

/**
 * Блок, который локальная модель не выдаёт, но выдаёт Claude Agent SDK (типы блоков —
 * из опорной версии). Объявлен, чтобы код фич проверял `block.type === 'text'`, а не читал
 * `.text` у любого блока: в режиме anthropic в `content` приходят и рассуждения, и инструменты.
 */
export interface OtherContentBlock {
  type:
    | 'thinking'
    | 'redacted_thinking'
    | 'tool_use'
    | 'server_tool_use'
    | 'web_search_tool_result'
    | 'web_fetch_tool_result'
    | 'advisor_tool_result'
    | 'code_execution_tool_result'
    | 'bash_code_execution_tool_result'
    | 'text_editor_code_execution_tool_result'
    | 'tool_search_tool_result'
    | 'mcp_tool_use'
    | 'mcp_tool_result'
    | 'container_upload'
    | 'compaction'
    | 'fallback'
    | 'mcp_tool_listing'
}

export type ContentBlock = TextBlock | OtherContentBlock

/** Сообщение пользователя в формате Messages API (`MessageParam` с ролью `user`). */
export interface UserMessageParam {
  role: 'user'
  content: string | TextBlock[]
}

export interface Usage {
  input_tokens: number
  output_tokens: number
  /** В сообщениях `assistant` оригинала бывает `null`; локально всегда 0. */
  cache_creation_input_tokens: number | null
  cache_read_input_tokens: number | null
}

/** Ответ модели (подмножество `BetaMessage`). */
export interface AssistantMessage {
  id: string
  type: 'message'
  role: 'assistant'
  model: string
  content: ContentBlock[]
  /** Локально бывают `end_turn` и `max_tokens`; остальные значения — из оригинала. */
  stop_reason:
    | 'end_turn'
    | 'max_tokens'
    | 'stop_sequence'
    | 'tool_use'
    | 'pause_turn'
    | 'compaction'
    | 'refusal'
    | 'model_context_window_exceeded'
    | null
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
  /**
   * Базовый набор встроенных инструментов Claude Code. Только он их ограничивает: `allowedTools`
   * в оригинале — список автоодобрения, а не фильтр. Код фич передаёт `tools: []`, чтобы
   * прод-агент на Claude Agent SDK не получил ФС и shell. Локально встроенных инструментов нет,
   * поэтому принимается только `[]`.
   */
  tools?: string[]
  allowedTools?: string[]
  disallowedTools?: string[]
  permissionMode?: PermissionMode
}

/**
 * Ответ на `interrupt()` (подмножество полей оригинала). Локально очереди сообщений нет,
 * поэтому `interrupt()` возвращает `undefined`, как оригинал, когда квитанции нет.
 */
export interface SDKControlInterruptResponse {
  still_queued: string[]
}

export interface Query extends AsyncGenerator<SDKMessage, void> {
  /** Прерывает текущий запрос к модели; генератор завершается без ошибки. */
  interrupt(): Promise<SDKControlInterruptResponse | undefined>
  setPermissionMode(mode: PermissionMode): Promise<void>
}
