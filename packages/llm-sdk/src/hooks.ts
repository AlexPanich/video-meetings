// Хуки `options.hooks`: выбор по matcher и последовательный вызов.
import type { HookCallbackMatcher, HookEvent, HookInput, HookJSONOutput, Options } from './types.js'

/**
 * Вызывает хуки события, чей matcher подходит к `matchValue` (имя инструмента, `source` или
 * `reason`), по порядку объявления. Исключение хука не роняет сессию: хук пропускается, как
 * `onFailure: 'continue'` по умолчанию в оригинале.
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
        outputs.push(await hook(input, toolUseID, { signal }))
      } catch {
        // Как в оригинале по умолчанию: сбой хука не блокирует действие.
      }
    }
  }
  return outputs
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
