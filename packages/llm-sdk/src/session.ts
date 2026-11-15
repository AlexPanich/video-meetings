// Общие данные сессии `query()`: их используют агентный цикл и выполнение инструментов.
import type { OllamaConfig } from './config.js'
import type { ContextBudget } from './context.js'
import type { OllamaMessage, OllamaTool } from './ollama.js'
import type { StructuredOutput } from './structured.js'
import type { RegisteredTool } from './tools.js'
import type { BaseHookInput, Options, PermissionMode } from './types.js'

/** Изменяемое состояние, к которому есть доступ у методов `Query`. */
export interface QueryState {
  permissionMode: PermissionMode
  /** `interrupt()`: генератор завершается без ошибки. */
  controller: AbortController
  /** `options.abortController` вызывающего кода: генератор бросает `AbortError`. */
  userSignal?: AbortSignal
  /** Срабатывает от любого из двух: его получают запросы к Ollama, хуки и инструменты. */
  signal: AbortSignal
}

export interface Session {
  id: string
  config: OllamaConfig
  model: string
  options: Options
  state: QueryState
  /** Полная история; в запрос уходит её версия, усечённая `context`. */
  history: OllamaMessage[]
  /** Дописывает новые сообщения истории в хранилище сессий; вызывается перед каждым `result`. */
  persist: () => Promise<void>
  context: ContextBudget
  tools: Map<string, RegisteredTool>
  ollamaTools: OllamaTool[]
  /** Проверка финального ответа по `outputFormat`; без него — `undefined`. */
  structured?: StructuredOutput
}

/** Общие поля входа хуков. */
export function hookBase(session: Session): BaseHookInput {
  return {
    session_id: session.id,
    transcript_path: '',
    cwd: process.cwd(),
    permission_mode: session.state.permissionMode,
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
