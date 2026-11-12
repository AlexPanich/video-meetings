// Выполнение одного вызова SDK-инструмента: хуки, права, проверка аргументов, обработчик.
import { untilAborted } from './abort.js'
import { runHooks } from './hooks.js'
import { decidePermission } from './permissions.js'
import { errorMessage, hookBase, isRecord } from './session.js'
import type { Session } from './session.js'
import type { CallToolResult, SDKPermissionDenial, ToolUseBlock } from './types.js'

export interface ToolOutcome {
  /** Текст для модели и для блока `tool_result`. */
  text: string
  isError: boolean
  /** `CallToolResult` обработчика (или описание ошибки) — `tool_use_result` сообщения. */
  raw: unknown
}

/**
 * Выполняет вызов: хуки `PreToolUse`, проверка прав, проверка аргументов по схеме, обработчик,
 * хуки `PostToolUse`. Неизвестный инструмент, отказ, неверные аргументы и исключение — ошибка для
 * модели (`is_error`), цикл продолжается. Отказ в правах попадает в `denials`.
 */
export async function executeTool(
  session: Session,
  call: ToolUseBlock,
  denials: SDKPermissionDenial[],
): Promise<ToolOutcome> {
  const registered = session.tools.get(call.name)
  if (!registered) return toolError(`No such tool available: ${call.name}`)
  const { options, state } = session
  const signal = state.controller.signal
  const input = isRecord(call.input) ? call.input : {}

  const hookOutputs = await runHooks(
    options.hooks,
    'PreToolUse',
    {
      ...hookBase(session),
      hook_event_name: 'PreToolUse',
      tool_name: call.name,
      tool_input: input,
      tool_use_id: call.id,
    },
    call.name,
    call.id,
    signal,
  )
  const permission = await decidePermission(
    { options, permissionMode: state.permissionMode, signal },
    registered,
    call.id,
    input,
    hookOutputs,
  )
  if (!permission.allowed) {
    denials.push({ tool_name: call.name, tool_use_id: call.id, tool_input: input })
    return toolError(permission.message)
  }

  const parsed = registered.schema.safeParse(permission.input)
  if (!parsed.success) {
    return toolError(`Invalid input for ${call.name}: ${parsed.error.message}`)
  }
  let result: CallToolResult
  try {
    // Обработчик может не слушать signal: после interrupt() его не ждём, цикл выходит сам.
    result = await untilAborted(registered.handler(parsed.data, { signal }), signal)
  } catch (error) {
    if (signal.aborted) return toolError(`Tool ${call.name} was interrupted`)
    return toolError(`Tool ${call.name} failed: ${errorMessage(error)}`)
  }
  // Обработчик без типов (JS, приведение) может вернуть не CallToolResult — это ошибка инструмента.
  if (!isRecord(result) || !Array.isArray(result.content)) {
    return toolError(`Tool ${call.name} returned an invalid result: expected { content: [...] }`)
  }
  await runHooks(
    options.hooks,
    'PostToolUse',
    {
      ...hookBase(session),
      hook_event_name: 'PostToolUse',
      tool_name: call.name,
      tool_input: permission.input,
      tool_response: result,
      tool_use_id: call.id,
    },
    call.name,
    call.id,
    signal,
  )
  return { text: resultText(result), isError: result.isError === true, raw: result }
}

function toolError(text: string): ToolOutcome {
  return { text, isError: true, raw: text }
}

/** Текст результата MCP: блоки `text` подряд, остальные — пометкой о типе. */
function resultText(result: CallToolResult): string {
  return result.content
    .map((block) => (block.type === 'text' ? block.text : `[${block.type}]`))
    .join('\n')
}
