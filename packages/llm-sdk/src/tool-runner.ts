// Выполнение вызовов SDK-инструментов одного ответа модели: хуки, права, проверка аргументов,
// обработчики (read-only — параллельно).
import { untilAborted } from './abort.js'
import { runHooks } from './hooks.js'
import { decidePermission } from './permissions.js'
import { errorMessage, hookBase, isRecord } from './session.js'
import type { Session } from './session.js'
import type { RegisteredTool } from './tools.js'
import type { CallToolResult, SDKPermissionDenial, ToolUseBlock } from './types.js'

export interface ToolOutcome {
  /** Текст для модели и для блока `tool_result`. */
  text: string
  isError: boolean
  /** `CallToolResult` обработчика (или описание ошибки) — `tool_use_result` сообщения. */
  raw: unknown
}

/**
 * Выполняет вызовы одного ответа модели в три фазы:
 *
 * 1. По очереди для каждого вызова: хуки `PreToolUse`, проверка прав, проверка аргументов по
 *    схеме — порядок решений детерминирован.
 * 2. Обработчики разрешённых вызовов: подряд идущие read-only (`annotations.readOnlyHint: true`)
 *    запускаются параллельно, остальные — по одному, группы — в порядке вызовов.
 * 3. Хуки `PostToolUse` успешных вызовов — в порядке вызовов, после всех обработчиков.
 *
 * Неизвестный инструмент, отказ, неверные аргументы и исключение — ошибка для модели
 * (`is_error`), цикл продолжается. Отказ в правах попадает в `denials`. Результаты — в порядке
 * `calls`; `undefined` — сессию остановили (`stopped()`), оставшиеся шаги не выполняются.
 */
export async function executeTools(
  session: Session,
  calls: ToolUseBlock[],
  denials: SDKPermissionDenial[],
  stopped: () => boolean,
): Promise<ToolOutcome[] | undefined> {
  const prepared: PreparedCall[] = []
  for (const call of calls) {
    // Отмена между вызовами: инструменты (и их побочные эффекты) уже не выполняются.
    if (stopped()) return undefined
    prepared.push(await prepareCall(session, call, denials))
  }

  const outcomes: HandlerOutcome[] = prepared.map((entry) =>
    'outcome' in entry ? { outcome: entry.outcome } : { outcome: toolError('') },
  )
  for (const group of handlerGroups(prepared)) {
    if (stopped()) return undefined
    const results = await Promise.all(group.map((index) => runHandler(session, prepared[index])))
    for (const [position, index] of group.entries()) outcomes[index] = results[position]
  }
  if (stopped()) return undefined

  for (const [index, entry] of prepared.entries()) {
    const { response } = outcomes[index]
    // Без ответа обработчика (отказ, ошибка, исключение) `PostToolUse` не вызывается.
    if ('outcome' in entry || !response) continue
    await runHooks(
      session.options.hooks,
      'PostToolUse',
      {
        ...hookBase(session),
        hook_event_name: 'PostToolUse',
        tool_name: entry.call.name,
        tool_input: entry.hookInput,
        tool_response: response,
        tool_use_id: entry.call.id,
      },
      entry.call.name,
      entry.call.id,
      session.state.signal,
    )
  }
  return outcomes.map((entry) => entry.outcome)
}

interface HandlerOutcome {
  outcome: ToolOutcome
  /** Ответ обработчика формы `CallToolResult` (в том числе с `isError`). */
  response?: CallToolResult
}

/** Вызов после фазы решений: готовый результат (ошибка, отказ) или разрешённый вызов. */
type PreparedCall =
  | { call: ToolUseBlock; outcome: ToolOutcome }
  | {
      call: ToolUseBlock
      registered: RegisteredTool
      /** Аргументы после проверки схемой — для обработчика. */
      args: Record<string, unknown>
      /** Итоговый ввод после хуков и `canUseTool` — `tool_input` хука `PostToolUse`. */
      hookInput: Record<string, unknown>
    }

async function prepareCall(
  session: Session,
  call: ToolUseBlock,
  denials: SDKPermissionDenial[],
): Promise<PreparedCall> {
  const registered = session.tools.get(call.name)
  if (!registered) return { call, outcome: toolError(`No such tool available: ${call.name}`) }
  const { options, state } = session
  const signal = state.signal
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
    return { call, outcome: toolError(permission.message) }
  }

  const parsed = registered.validate(permission.input)
  if (!parsed.success) {
    return { call, outcome: toolError(`Invalid input for ${call.name}: ${parsed.message}`) }
  }
  return { call, registered, args: parsed.data, hookInput: permission.input }
}

/**
 * Индексы разрешённых вызовов, сгруппированные для запуска: подряд идущие read-only — одна
 * группа, каждый остальной — своя. Вызовы с готовым результатом группы не разрывают: обработчик
 * у них не запускается.
 */
function handlerGroups(prepared: PreparedCall[]): number[][] {
  const groups: number[][] = []
  let readOnly: number[] | undefined
  for (const [index, entry] of prepared.entries()) {
    if ('outcome' in entry) continue
    if (entry.registered.readOnly) {
      if (!readOnly) groups.push((readOnly = []))
      readOnly.push(index)
    } else {
      readOnly = undefined
      groups.push([index])
    }
  }
  return groups
}

/** Обработчик разрешённого вызова; не отклоняется — исключение становится ошибкой для модели. */
async function runHandler(session: Session, entry: PreparedCall): Promise<HandlerOutcome> {
  if ('outcome' in entry) return { outcome: entry.outcome }
  const { call, registered, args } = entry
  const signal = session.state.signal
  let result: CallToolResult
  try {
    // Обработчик может не слушать signal: после interrupt() его не ждём, цикл выходит сам.
    result = await untilAborted(registered.handler(args, { signal }), signal)
  } catch (error) {
    if (signal.aborted) return { outcome: toolError(`Tool ${call.name} was interrupted`) }
    return { outcome: toolError(`Tool ${call.name} failed: ${errorMessage(error)}`) }
  }
  // Обработчик без типов (JS, приведение) может вернуть не CallToolResult — это ошибка инструмента.
  if (!isRecord(result) || !Array.isArray(result.content)) {
    return {
      outcome: toolError(
        `Tool ${call.name} returned an invalid result: expected { content: [...] }`,
      ),
    }
  }
  return {
    outcome: { text: resultText(result), isError: result.isError === true, raw: result },
    response: result,
  }
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
