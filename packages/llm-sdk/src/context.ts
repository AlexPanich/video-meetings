// Контроль размера контекста: вход сверх `num_ctx` Ollama молча отбрасывает, поэтому SDK сам
// оценивает объём запроса и усекает старые результаты инструментов.
import type { OllamaMessage, OllamaTool } from './ollama.js'

/** Начальная (консервативная) оценка: символов на токен. Русский текст у Qwen — около 3. */
const DEFAULT_CHARS_PER_TOKEN = 3
/** Служебные токены шаблона чата на сообщение. */
const MESSAGE_OVERHEAD_TOKENS = 8
/** Запас на пометку об усечении. */
const MARKER_RESERVE_CHARS = 120
/** Доля окна под ответ модели (вход и выход делят `num_ctx`), но не больше 4096 токенов. */
const OUTPUT_RESERVE_SHARE = 0.25
const OUTPUT_RESERVE_MAX_TOKENS = 4096

/**
 * Бюджет входа одной сессии. Объём оценивается по символам; оценка уточняется по фактическому
 * `prompt_eval_count` ответов Ollama, но только в сторону уменьшения символов на токен — чтобы
 * не недооценить вход.
 */
export class ContextBudget {
  private charsPerToken = DEFAULT_CHARS_PER_TOKEN
  /** Токенов на вход: `num_ctx` минус запас под ответ. */
  readonly inputTokens: number

  constructor(numCtx: number) {
    const reserve = Math.min(OUTPUT_RESERVE_MAX_TOKENS, Math.floor(numCtx * OUTPUT_RESERVE_SHARE))
    this.inputTokens = numCtx - reserve
  }

  /**
   * Сообщения для запроса, которые помещаются в бюджет. Пока всё помещается — те же сообщения.
   * Иначе усекается содержимое результатов инструментов (роль `tool`), начиная со старых;
   * последний результат — только если без этого не помещается. Пары «вызов — результат»,
   * системный промпт и сообщения пользователя не трогаются. История сессии не меняется.
   */
  fit(messages: OllamaMessage[], tools: OllamaTool[]): OllamaMessage[] {
    let excessChars = this.toChars(this.estimate(messages, tools) - this.inputTokens)
    if (excessChars <= 0) return messages

    const fitted = messages.map((message) => ({ ...message }))
    const toolIndexes = fitted.flatMap((message, index) => (message.role === 'tool' ? [index] : []))
    for (const index of toolIndexes) {
      if (excessChars <= 0) break
      const message = fitted[index]
      const original = message.content
      const truncated = truncate(original, original.length - excessChars - MARKER_RESERVE_CHARS)
      // Короткий результат с пометкой стал бы длиннее — его не трогаем.
      if (truncated.length >= original.length) continue
      message.content = truncated
      excessChars -= original.length - truncated.length
    }
    return fitted
  }

  /** Уточняет оценку по числу токенов входа, которое насчитала Ollama. */
  calibrate(
    messages: OllamaMessage[],
    tools: OllamaTool[],
    promptTokens: number | undefined,
  ): void {
    if (!promptTokens) return
    const chars = this.charsOf(messages, tools)
    const observed = chars / Math.max(1, promptTokens - messages.length * MESSAGE_OVERHEAD_TOKENS)
    // Ollama могла уже обрезать вход, тогда observed завышен: учитываем только уменьшение.
    if (observed > 0 && observed < this.charsPerToken) {
      this.charsPerToken = Math.max(1, observed)
    }
  }

  /** Оценка токенов запроса. */
  estimate(messages: OllamaMessage[], tools: OllamaTool[]): number {
    return (
      Math.ceil(this.charsOf(messages, tools) / this.charsPerToken) +
      messages.length * MESSAGE_OVERHEAD_TOKENS
    )
  }

  private toChars(tokens: number): number {
    return Math.ceil(tokens * this.charsPerToken)
  }

  private charsOf(messages: OllamaMessage[], tools: OllamaTool[]): number {
    let chars = tools.length > 0 ? JSON.stringify(tools).length : 0
    for (const message of messages) {
      chars += message.content.length
      if (message.role === 'assistant' && message.tool_calls) {
        chars += JSON.stringify(message.tool_calls).length
      }
      if (message.role === 'tool') chars += message.tool_name.length
    }
    return chars
  }
}

/** Оставляет начало текста длиной `keep` и пометку, сколько символов отрезано. */
function truncate(text: string, keep: number): string {
  if (keep >= text.length) return text
  const kept = Math.max(0, keep)
  const removed = text.length - kept
  return `${text.slice(0, kept)}\n[truncated: ${removed} of ${text.length} characters removed to fit the context window]`
}
