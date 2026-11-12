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

/** Вход не помещается в `num_ctx` даже после усечения: запрос не отправляется. */
export class ContextOverflowError extends Error {
  constructor(estimatedTokens: number, inputTokens: number, numCtx: number) {
    super(
      `Context window exceeded: the request needs about ${estimatedTokens} tokens, ` +
        `the input budget is ${inputTokens} of num_ctx ${numCtx}`,
    )
    this.name = 'ContextOverflowError'
  }
}

/** Запрос, подогнанный под бюджет. */
export interface FittedRequest {
  messages: OllamaMessage[]
  /** `num_predict`: остаток окна после входа, не меньше `outputReserve`. */
  numPredict: number
}

/**
 * Бюджет входа одной сессии. Объём оценивается по символам; оценка уточняется по фактическому
 * `prompt_eval_count` ответов Ollama, но только в сторону уменьшения символов на токен — чтобы
 * не недооценить вход.
 */
export class ContextBudget {
  private charsPerToken = DEFAULT_CHARS_PER_TOKEN
  /** Символов в описаниях инструментов: набор в сессии не меняется, считается один раз. */
  private readonly toolsChars: number
  /** Токенов под ответ: гарантированный минимум `num_predict`. */
  readonly outputReserve: number
  /** Токенов на вход: `num_ctx` минус запас под ответ. */
  readonly inputTokens: number

  constructor(
    private readonly numCtx: number,
    tools: OllamaTool[],
  ) {
    this.outputReserve = Math.min(
      OUTPUT_RESERVE_MAX_TOKENS,
      Math.floor(numCtx * OUTPUT_RESERVE_SHARE),
    )
    this.inputTokens = numCtx - this.outputReserve
    this.toolsChars = tools.length > 0 ? JSON.stringify(tools).length : 0
  }

  /**
   * Сообщения для запроса, которые помещаются в бюджет, и `num_predict` под ответ. Пока всё
   * помещается — те же сообщения. Иначе:
   * 1. усекается содержимое результатов инструментов (роль `tool`), начиная со старых;
   * 2. если этого мало — самые старые обмены «вызов — результаты» убираются целиком и заменяются
   *    одной пометкой `[N earlier tool calls … omitted …]` (столько, сколько нужно);
   * 3. результаты последнего обмена усекаются, только если без этого не помещается никак;
   * 4. не помещается и так (большой системный промпт или сообщение пользователя) —
   *    `ContextOverflowError`: иначе Ollama молча отбросила бы часть входа.
   * История сессии не меняется.
   */
  fit(messages: OllamaMessage[]): FittedRequest {
    const estimated = this.estimate(messages)
    if (estimated <= this.inputTokens) return this.request(messages, estimated)

    const exchanges = toolExchanges(messages)
    for (const keepLast of [true, false]) {
      const attempt = (removed: number) => {
        const candidate =
          removed > 0 ? collapseExchanges(messages, exchanges.slice(0, removed)) : messages
        const fitted = this.truncateToolResults(candidate, keepLast)
        const tokens = this.estimate(fitted)
        return tokens <= this.inputTokens ? this.request(fitted, tokens) : undefined
      }
      // Чем больше обменов убрано, тем меньше вход: ищем минимальное число бинарным поиском.
      const maxRemoved = Math.max(0, exchanges.length - 1)
      let found = attempt(0)
      if (!found && maxRemoved > 0 && attempt(maxRemoved)) {
        let low = 0
        let high = maxRemoved
        while (high - low > 1) {
          const middle = Math.floor((low + high) / 2)
          if (attempt(middle)) high = middle
          else low = middle
        }
        found = attempt(high)
      }
      if (found) return found
    }
    throw new ContextOverflowError(estimated, this.inputTokens, this.numCtx)
  }

  /** Уточняет оценку по числу токенов входа, которое насчитала Ollama. */
  calibrate(messages: OllamaMessage[], promptTokens: number | undefined): void {
    if (!promptTokens) return
    const chars = this.charsOf(messages)
    const observed = chars / Math.max(1, promptTokens - messages.length * MESSAGE_OVERHEAD_TOKENS)
    // Ollama могла уже обрезать вход, тогда observed завышен: учитываем только уменьшение.
    if (observed > 0 && observed < this.charsPerToken) {
      this.charsPerToken = Math.max(1, observed)
    }
  }

  /** Оценка токенов запроса. */
  estimate(messages: OllamaMessage[]): number {
    return (
      Math.ceil(this.charsOf(messages) / this.charsPerToken) +
      messages.length * MESSAGE_OVERHEAD_TOKENS
    )
  }

  private request(messages: OllamaMessage[], estimated: number): FittedRequest {
    return { messages, numPredict: this.numCtx - estimated }
  }

  /**
   * Усекает результаты инструментов со старых, пока не уберёт превышение (копии сообщений).
   * `keepLast` — результаты последнего обмена не трогать.
   */
  private truncateToolResults(messages: OllamaMessage[], keepLast: boolean): OllamaMessage[] {
    let excessChars = Math.ceil((this.estimate(messages) - this.inputTokens) * this.charsPerToken)
    if (excessChars <= 0) return messages
    const protectedFrom = keepLast
      ? (toolExchanges(messages).at(-1)?.start ?? messages.length)
      : messages.length
    const fitted = [...messages]
    for (const [index, message] of fitted.entries()) {
      if (excessChars <= 0 || index >= protectedFrom) break
      if (message.role !== 'tool') continue
      const original = message.content
      const truncated = truncate(original, original.length - excessChars - MARKER_RESERVE_CHARS)
      // Короткий результат с пометкой стал бы длиннее — его не трогаем.
      if (truncated.length >= original.length) continue
      fitted[index] = { ...message, content: truncated }
      excessChars -= original.length - truncated.length
    }
    return fitted
  }

  private charsOf(messages: OllamaMessage[]): number {
    let chars = this.toolsChars
    for (const message of messages) chars += messageChars(message)
    return chars
  }
}

/** Символы сообщения; кешируются: история не меняется, а считается на каждом ходу. */
const messageCharsCache = new WeakMap<OllamaMessage, number>()

function messageChars(message: OllamaMessage): number {
  const cached = messageCharsCache.get(message)
  if (cached !== undefined) return cached
  let chars = message.content.length
  if (message.role === 'assistant' && message.tool_calls) {
    chars += JSON.stringify(message.tool_calls).length
  }
  if (message.role === 'tool') chars += message.tool_name.length
  messageCharsCache.set(message, chars)
  return chars
}
/** Обмен: сообщение `assistant` с `tool_calls` и идущие за ним результаты — `[start, end)`. */
interface Exchange {
  start: number
  end: number
  calls: number
}

function toolExchanges(messages: OllamaMessage[]): Exchange[] {
  const exchanges: Exchange[] = []
  for (const [index, message] of messages.entries()) {
    if (message.role !== 'assistant' || !message.tool_calls?.length) continue
    let end = index + 1
    while (messages[end]?.role === 'tool') end += 1
    exchanges.push({ start: index, end, calls: message.tool_calls.length })
  }
  return exchanges
}

/** Убирает обмены и ставит на место первого из них одну пометку. */
function collapseExchanges(messages: OllamaMessage[], removed: Exchange[]): OllamaMessage[] {
  const calls = removed.reduce((sum, exchange) => sum + exchange.calls, 0)
  const note: OllamaMessage = {
    role: 'assistant',
    content: `[${calls} earlier tool calls and their results were omitted to fit the context window]`,
  }
  const result: OllamaMessage[] = []
  let next = 0
  for (const [index, exchange] of removed.entries()) {
    result.push(...messages.slice(next, exchange.start))
    if (index === 0) result.push(note)
    next = exchange.end
  }
  result.push(...messages.slice(next))
  return result
}

/** Оставляет начало текста длиной `keep` и пометку, сколько символов отрезано. */
function truncate(text: string, keep: number): string {
  if (keep >= text.length) return text
  const kept = Math.max(0, keep)
  const removed = text.length - kept
  return `${text.slice(0, kept)}\n[truncated: ${removed} of ${text.length} characters removed to fit the context window]`
}
