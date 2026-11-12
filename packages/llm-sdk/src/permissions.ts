// Права на вызов SDK-инструмента: хуки PreToolUse, permissionMode, allowedTools и canUseTool.
import { untilAborted } from './abort.js'
import type { RegisteredTool } from './tools.js'
import type { HookJSONOutput, Options, PermissionMode } from './types.js'

/** Имя инструмента, `mcp__<server>` или `mcp__<server>__*` — все инструменты сервера. */
export function matchesToolList(registered: RegisteredTool, list: string[] = []): boolean {
  const server = `mcp__${registered.server}`
  return list.some(
    (entry) => entry === registered.name || entry === server || entry === `${server}__*`,
  )
}

export type PermissionOutcome =
  { allowed: true; input: Record<string, unknown> } | { allowed: false; message: string }

export interface PermissionContext {
  options: Options
  permissionMode: PermissionMode
  signal: AbortSignal
}

/**
 * Решение по вызову. `disallowedTools` сюда не доходят: такие инструменты не видны модели и
 * вызываются как неизвестные. Порядок:
 * 1. `deny` любого хука `PreToolUse` (и его сбой) — отказ с причиной; `updatedInput` хуков меняет
 *    ввод: все хуки получают исходный ввод, при нескольких `updatedInput` действует последний;
 * 2. `plan` — инструменты не выполняются;
 * 3. `allow` хука, `bypassPermissions` или инструмент из `allowedTools` — выполнить;
 * 4. иначе решает `canUseTool` (кроме `dontAsk`); без него — отказ.
 * `acceptEdits` и `auto` для SDK-инструментов работают как `default`.
 */
export async function decidePermission(
  context: PermissionContext,
  registered: RegisteredTool,
  toolUseID: string,
  input: Record<string, unknown>,
  hookOutputs: HookJSONOutput[],
): Promise<PermissionOutcome> {
  const { options, permissionMode, signal } = context
  const name = registered.name
  let updatedInput = input
  let hookAllowed = false
  for (const output of hookOutputs) {
    const specific = output.hookSpecificOutput
    if (specific?.hookEventName !== 'PreToolUse') continue
    if (specific.permissionDecision === 'deny') {
      return deny(
        specific.permissionDecisionReason ?? `Tool ${name} was blocked by a PreToolUse hook`,
      )
    }
    if (specific.updatedInput) updatedInput = specific.updatedInput
    if (specific.permissionDecision === 'allow') hookAllowed = true
  }

  if (permissionMode === 'plan') {
    return deny(`Tool ${name} is not executed in plan mode`)
  }
  if (
    hookAllowed ||
    permissionMode === 'bypassPermissions' ||
    matchesToolList(registered, options.allowedTools)
  ) {
    return { allowed: true, input: updatedInput }
  }
  if (permissionMode !== 'dontAsk' && options.canUseTool) {
    try {
      const result = await untilAborted(
        options.canUseTool(name, updatedInput, { signal, toolUseID }),
        signal,
      )
      return result.behavior === 'allow'
        ? { allowed: true, input: result.updatedInput ?? updatedInput }
        : deny(result.message)
    } catch (error) {
      return deny(
        `Permission check for ${name} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return deny(`Permission to use ${name} has been denied`)
}

function deny(message: string): PermissionOutcome {
  return { allowed: false, message }
}
