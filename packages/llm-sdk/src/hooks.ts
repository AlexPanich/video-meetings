// Хуки `options.hooks`: выбор по matcher и последовательный вызов.
import { untilAborted } from './abort.js'
import type { HookCallbackMatcher, HookEvent, HookInput, HookJSONOutput, Options } from './types.js'

/**
 * Вызывает хуки события, чей matcher подходит к `matchValue` (имя инструмента, `source` или
 * `reason`), по порядку объявления. Исключение хука не роняет сессию. Сбой `PreToolUse`
 * считается отказом (`deny`): охранный хук — часто единственная защита при
 * `bypassPermissions`, и его сбой не должен пропускать вызов. Сбой остальных событий —
 * хук пропускается (как `onFailure: 'continue'` в оригинале). О любом сбое — `process.emitWarning`.
 * После `interrupt()` хук, который не слушает `signal`, не ждём.
 */
export async function runHooks(
  hooks: Options['hooks'],
  event: HookEvent,
  input: HookInput,
  matchValue: string | undefined,
  toolUseID: string | undefined,
  signal: AbortSignal,
): Promise<HookJSONOutput[]> {
  const outputs: HookJSONOutput[] = []
  for (const matcher of hooks?.[event] ?? []) {
    if (!matches(matcher, matchValue)) continue
    for (const hook of matcher.hooks) {
      try {
        outputs.push(
          await untilAborted(Promise.resolve(hook(input, toolUseID, { signal })), signal),
        )
      } catch (error) {
        // После interrupt() результат уже не нужен: сессия завершается, предупреждать не о чем.
        const reason = signal.aborted ? 'interrupted' : errorText(error)
        if (!signal.aborted) {
          process.emitWarning(`${event} hook failed: ${reason}`, { code: 'LLM_SDK_HOOK_FAILED' })
        }
        if (event === 'PreToolUse') outputs.push(failedPreToolUse(reason))
        if (signal.aborted) return outputs
      }
    }
  }
  return outputs
}

function failedPreToolUse(reason: string): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `PreToolUse hook failed: ${reason}`,
    },
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Пусто или `*` — всё; только буквы, цифры, `_` и `|` — точные значения через `|`; иначе —
 * регулярное выражение (поиск подстроки, как `RegExp.test`). Некорректное выражение не подходит
 * ни к чему.
 */
function matches(matcher: HookCallbackMatcher, value: string | undefined): boolean {
  const pattern = matcher.matcher
  if (pattern === undefined || pattern === '' || pattern === '*') return true
  if (value === undefined) return false
  if (/^[\w|]+$/.test(pattern)) return pattern.split('|').includes(value)
  try {
    return new RegExp(pattern).test(value)
  } catch {
    return false
  }
}
