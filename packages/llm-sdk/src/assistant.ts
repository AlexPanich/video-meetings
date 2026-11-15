// Ответ Ollama → сообщение `assistant` в форме оригинала: текст без рассуждения, блоки `tool_use`.
import { randomUUID } from 'node:crypto'
import type { OllamaChatResponse, OllamaToolCall } from './ollama.js'
import { isRecord } from './session.js'
import type { AssistantMessage, ContentBlock, ToolUseBlock, Usage } from './types.js'

/** Вызов инструмента: блок `tool_use` с новым id и вызов в форме Ollama для истории. */
export interface ToolUse {
  block: ToolUseBlock
  ollama: OllamaToolCall
}

/** Вызов инструмента из ответа Ollama: блок `tool_use` с новым id и вызов для истории. */
export function toolUse(call: OllamaToolCall): ToolUse {
  const input = parseArguments(call.function.arguments)
  return {
    block: { type: 'tool_use', id: `toolu_${randomUUID()}`, name: call.function.name, input },
    ollama: { function: { name: call.function.name, arguments: input } },
  }
}

/** Аргументы-строка разбираются как JSON; не объект — пустой объект (схема его отклонит). */
function parseArguments(raw: OllamaToolCall['function']['arguments']): Record<string, unknown> {
  if (typeof raw !== 'string') return raw
  try {
    const value: unknown = JSON.parse(raw)
    return isRecord(value) ? value : {}
  } catch {
    return {}
  }
}

/**
 * Qwen3 может вернуть рассуждение `<think>…</think>` в начале текста. Если ответ оборван внутри
 * рассуждения (нет `</think>`), отрезается всё: рассуждение не выдаётся за ответ.
 */
export function stripThinking(content: string): string {
  return content.replace(/^\s*<think>[\s\S]*?(<\/think>\s*|$)/, '')
}

export function stopReason(
  hasToolUse: boolean,
  doneReason: string | undefined,
): AssistantMessage['stop_reason'] {
  if (hasToolUse) return 'tool_use'
  return doneReason === 'length' ? 'max_tokens' : 'end_turn'
}

export function assistantMessage(
  response: OllamaChatResponse,
  id: string,
  requestedModel: string,
  text: string,
  toolUses: ToolUseBlock[],
): AssistantMessage {
  const usage: Usage = {
    input_tokens: response.prompt_eval_count ?? 0,
    output_tokens: response.eval_count ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
  // Без вызовов текстовый блок есть всегда (даже пустой), как в фазе 1; с вызовами — если есть текст.
  const content: ContentBlock[] =
    toolUses.length === 0 || text !== '' ? [{ type: 'text', text }, ...toolUses] : toolUses
  return {
    id,
    type: 'message',
    role: 'assistant',
    model: response.model || requestedModel,
    content,
    stop_reason: stopReason(toolUses.length > 0, response.done_reason),
    stop_sequence: null,
    usage,
  }
}
