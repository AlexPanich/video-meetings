// Публичные типы, повторяющие `@anthropic-ai/claude-agent-sdk` (опорная версия — в devDependencies
// package.json). Описано подмножество, которое реализует SDK: имена и формы полей совпадают с
// оригиналом, чтобы код фич компилировался с обеими реализациями (см. packages/llm/test/compat).
import type { UUID } from 'node:crypto'
import type { MessageParam } from '@anthropic-ai/sdk/resources'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import type { ZodRawShape as ZodRawShapeV3 } from 'zod/v3'
import type { ZodRawShape as ZodRawShapeV4 } from 'zod/v4'

export type { CallToolResult, McpServer, ToolAnnotations }

export type PermissionMode =
  'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'

/** Блок текста в сообщении (как `TextBlockParam`/`BetaTextBlock` Messages API). */
export interface TextBlock {
  type: 'text'
  text: string
}

/** Вызов инструмента моделью (подмножество `BetaToolUseBlock`). */
export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

/**
 * Блок, который локальная модель не выдаёт, но выдаёт Claude Agent SDK (типы блоков —
 * из опорной версии). Объявлен, чтобы код фич проверял `block.type`, а не читал
 * `.text` у любого блока: в режиме anthropic в `content` приходят и рассуждения, и серверные
 * инструменты.
 */
export interface OtherContentBlock {
  type:
    | 'thinking'
    | 'redacted_thinking'
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

export type ContentBlock = TextBlock | ToolUseBlock | OtherContentBlock

/**
 * Сообщение пользователя — `MessageParam` Messages API, как в оригинале (тип только для
 * компиляции, модуль `@anthropic-ai/sdk` не загружается). Сообщения SDK с результатами
 * инструментов несут блоки `tool_result`. Из сообщений `prompt` модель получает только блоки
 * `text`.
 */
export type UserMessageParam = MessageParam

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
  /** Локально бывают `end_turn`, `tool_use` и `max_tokens`; остальные значения — из оригинала. */
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
  /** У сообщений SDK с `tool_result` — `CallToolResult` инструмента (как в оригинале — unknown). */
  tool_use_result?: unknown
  uuid?: UUID
  /** Необязателен, как в оригинале; сообщения SDK несут id сессии всегда. */
  session_id?: string
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

// --- SDK-инструменты (in-process MCP) ---

/** Форма схемы `tool()`: объект полей zod 3 или zod 4 (локально выполняются только zod 4). */
export type AnyZodRawShape = ZodRawShapeV3 | ZodRawShapeV4

/** Тип аргументов обработчика по форме схемы. */
export type InferShape<T extends AnyZodRawShape> = {
  [K in keyof T]: T[K] extends { _output: infer O } ? O : never
} & {}

/** Определение инструмента, которое возвращает `tool()`. */
export interface SdkMcpToolDefinition<Schema extends AnyZodRawShape = AnyZodRawShape> {
  name: string
  description: string
  inputSchema: Schema
  annotations?: ToolAnnotations
  _meta?: Record<string, unknown>
  handler: (args: InferShape<Schema>, extra: unknown) => Promise<CallToolResult>
}

export interface CreateSdkMcpServerOptions {
  name: string
  version?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- как в оригинале: схемы инструментов разные
  tools?: Array<SdkMcpToolDefinition<any>>
}

/** Конфиг SDK-сервера для `options.mcpServers` (содержит живой `McpServer`, не сериализуется). */
export interface McpSdkServerConfigWithInstance {
  type: 'sdk'
  name: string
  instance: McpServer
}

/** Локально поддерживаются только SDK-серверы (`createSdkMcpServer`), без stdio/http. */
export type McpServerConfig = McpSdkServerConfigWithInstance

// --- Права ---

export type PermissionResult =
  | {
      behavior: 'allow'
      /** Заменяет ввод инструмента. */
      updatedInput?: Record<string, unknown>
    }
  | {
      behavior: 'deny'
      /** Уходит модели в `tool_result` с `is_error`. */
      message: string
    }

export type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    /** Срабатывает при `interrupt()`. */
    signal: AbortSignal
    /** Id вызова (`tool_use.id`). */
    toolUseID: string
  },
) => Promise<PermissionResult>

// --- Хуки ---

/** События, которые вызывает локальный SDK. */
export type HookEvent =
  'PreToolUse' | 'PostToolUse' | 'UserPromptSubmit' | 'SessionStart' | 'SessionEnd' | 'Stop'

/**
 * События оригинала, которые локальный SDK не вызывает. Объявлены, чтобы `HookCallback`
 * оригинала и локальный были совместимы: код фичи обязан проверять `hook_event_name`.
 */
export type OtherHookEvent =
  | 'PostToolUseFailure'
  | 'PostToolBatch'
  | 'Notification'
  | 'UserPromptExpansion'
  | 'StopFailure'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PostCompact'
  | 'PreModelSwitch'
  | 'PostModelSwitch'
  | 'PermissionRequest'
  | 'PermissionDenied'
  | 'Setup'
  | 'TeammateIdle'
  | 'TaskCreated'
  | 'TaskCompleted'
  | 'Elicitation'
  | 'ElicitationResult'
  | 'ConfigChange'
  | 'WorktreeCreate'
  | 'WorktreeRemove'
  | 'InstructionsLoaded'
  | 'CwdChanged'
  | 'FileChanged'
  | 'DirectoryAdded'
  | 'MessageDisplay'

export interface BaseHookInput {
  session_id: string
  /** Локально транскрипт не пишется — пустая строка. */
  transcript_path: string
  cwd: string
  permission_mode?: string
}

export interface PreToolUseHookInput extends BaseHookInput {
  hook_event_name: 'PreToolUse'
  tool_name: string
  tool_input: unknown
  tool_use_id: string
}

export interface PostToolUseHookInput extends BaseHookInput {
  hook_event_name: 'PostToolUse'
  tool_name: string
  tool_input: unknown
  /** `CallToolResult` инструмента. */
  tool_response: unknown
  tool_use_id: string
}

export interface UserPromptSubmitHookInput extends BaseHookInput {
  hook_event_name: 'UserPromptSubmit'
  prompt: string
}

export interface SessionStartHookInput extends BaseHookInput {
  hook_event_name: 'SessionStart'
  /** Локально всегда `startup`. */
  source: 'startup' | 'resume' | 'clear' | 'compact' | 'fork'
}

export type ExitReason = 'clear' | 'resume' | 'logout' | 'prompt_input_exit' | 'other'

export interface SessionEndHookInput extends BaseHookInput {
  hook_event_name: 'SessionEnd'
  /** Локально всегда `other`. */
  reason: ExitReason
}

export interface StopHookInput extends BaseHookInput {
  hook_event_name: 'Stop'
  stop_hook_active: boolean
  last_assistant_message?: string
}

export interface OtherHookInput extends BaseHookInput {
  hook_event_name: OtherHookEvent
}

export type HookInput =
  | PreToolUseHookInput
  | PostToolUseHookInput
  | UserPromptSubmitHookInput
  | SessionStartHookInput
  | SessionEndHookInput
  | StopHookInput
  | OtherHookInput

export type HookPermissionDecision = 'allow' | 'deny' | 'ask' | 'defer'

export interface PreToolUseHookSpecificOutput {
  hookEventName: 'PreToolUse'
  /** `deny` блокирует вызов, `allow` разрешает без проверки прав, `ask`/`defer` — обычная проверка. */
  permissionDecision?: HookPermissionDecision
  permissionDecisionReason?: string
  updatedInput?: Record<string, unknown>
}

/** Ответ хука. Локально действует только `hookSpecificOutput` у `PreToolUse`. */
export interface HookJSONOutput {
  continue?: boolean
  suppressOutput?: boolean
  stopReason?: string
  decision?: 'approve' | 'block'
  systemMessage?: string
  reason?: string
  hookSpecificOutput?: PreToolUseHookSpecificOutput
}

export type HookCallback = (
  input: HookInput,
  toolUseID: string | undefined,
  options: { signal: AbortSignal },
) => Promise<HookJSONOutput>

export interface HookCallbackMatcher {
  /**
   * Для событий инструментов — по имени инструмента, `SessionStart` — по `source`,
   * `SessionEnd` — по `reason`. Нет, пусто или `*` — все; буквы, цифры, `_` и `|` — точные имена
   * через `|`; иначе — регулярное выражение.
   */
  matcher?: string
  hooks: HookCallback[]
}

/**
 * Опции `query()`. Подмножество опций оригинала: модель, системный промпт, SDK-инструменты,
 * права, хуки и лимит ходов.
 */
export interface Options {
  /** Модель Ollama, перекрывает `OLLAMA_MODEL`. */
  model?: string
  /** Системный промпт; массив склеивается через пустую строку. */
  systemPrompt?: string | string[]
  /** Лимит запросов к модели на одно сообщение пользователя; сверх него — `error_max_turns`. */
  maxTurns?: number
  /**
   * Базовый набор встроенных инструментов Claude Code. Только он их ограничивает: `allowedTools`
   * в оригинале — список автоодобрения, а не фильтр. Код фич передаёт `tools: []`, чтобы
   * прод-агент на Claude Agent SDK не получил ФС и shell. Локально встроенных инструментов нет,
   * поэтому принимается только `[]`.
   */
  tools?: string[]
  /** SDK-серверы из `createSdkMcpServer()`; инструменты называются `mcp__<ключ>__<имя>`. */
  mcpServers?: Record<string, McpServerConfig>
  /** Автоодобрение: имена инструментов или `mcp__<сервер>` для всех инструментов сервера. */
  allowedTools?: string[]
  /** Запрет: инструмент не уходит модели и не выполняется ни при каких правах. */
  disallowedTools?: string[]
  permissionMode?: PermissionMode
  /** Решает за инструменты вне `allowedTools`; без него такие вызовы отклоняются. */
  canUseTool?: CanUseTool
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>
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
