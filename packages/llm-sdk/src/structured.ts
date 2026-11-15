// Структурированный ответ (`options.outputFormat`): проверка финального ответа модели по JSON Schema.
import { z } from 'zod'
import type { OutputFormat } from './types.js'

/** Попыток получить ответ по схеме на одно сообщение пользователя: первая и два повтора. */
export const STRUCTURED_OUTPUT_ATTEMPTS = 3

export type StructuredCheck = { ok: true; value: unknown } | { ok: false; error: string }

export interface StructuredOutput {
  schema: Record<string, unknown>
  check(text: string): StructuredCheck
}

/**
 * Готовит проверку по схеме `outputFormat`. Схема, которую zod не может разобрать, — ошибка
 * сразу: иначе каждый ответ модели был бы «не по схеме».
 */
export function structuredOutput(format: OutputFormat | undefined): StructuredOutput | undefined {
  if (!format) return undefined
  if (format.type !== 'json_schema') {
    throw new Error(`Unsupported outputFormat type: ${String(format.type)}`)
  }
  let validator: z.ZodType
  try {
    validator = z.fromJSONSchema(format.schema)
  } catch (error) {
    throw new Error(`outputFormat.schema is not a supported JSON Schema`, { cause: error })
  }
  return {
    schema: format.schema,
    check(text) {
      let value: unknown
      try {
        value = JSON.parse(text)
      } catch {
        return { ok: false, error: 'The response is not valid JSON.' }
      }
      const parsed = validator.safeParse(value)
      // Ответ модели как есть: zod-объект без `additionalProperties: false` отрезал бы лишние
      // ключи, которые схема разрешает (оригинал отдаёт разобранный JSON целиком).
      if (parsed.success) return { ok: true, value }
      const issues = parsed.error.issues.map(
        (issue) => `- ${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`,
      )
      return {
        ok: false,
        error: `The response does not match the JSON schema:\n${issues.join('\n')}`,
      }
    },
  }
}

/**
 * Сообщение модели после ответа не по схеме: что не так и что ответить. Ответ, оборванный по
 * `num_predict`, — повод отвечать короче, а не просто повторить.
 */
export function retryPrompt(error: string, truncated: boolean): string {
  const cut = truncated
    ? '\nThe response was cut off by the output length limit, keep it shorter.'
    : ''
  return `${error}${cut}\nRespond again with only a JSON value that matches the required JSON schema, without any other text.`
}
