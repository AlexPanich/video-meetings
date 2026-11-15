// Чанки потокового ответа Ollama → события Messages API для `stream_event` (`includePartialMessages`).
import { stopReason, stripThinking, toolUse } from './assistant.js'
import type { ToolUse } from './assistant.js'
import type { OllamaChatResponse } from './ollama.js'
import type { StreamEvent } from './types.js'

/**
 * События одного ответа модели: `message_start`, блоки `text` (`text_delta`) и `tool_use`
 * (`input_json_delta`), `message_delta` с `stop_reason` и `usage`, `message_stop`. Рассуждение
 * `<think>` в `text_delta` не попадает. Блоки `tool_use` получают id, которые потом несёт полное
 * сообщение `assistant` (`calls`).
 */
export class StreamTranslator {
  /** Вызовы инструментов в порядке прихода: их блоки уже отданы событиями. */
  readonly calls: ToolUse[] = []
  /** Модель из первого чанка (как в `message_start`). */
  model = ''
  /** Весь текст ответа как есть, с рассуждением. */
  raw = ''
  private started = false
  /**
   * Начало ответа уже известно (рассуждение отрезано или его нет): дальше каждый чанк — прирост
   * текста как есть, без повторного разбора всего ответа.
   */
  private settled = false
  private openText: number | undefined
  private nextIndex = 0

  constructor(
    private readonly messageId: string,
    private readonly requestedModel: string,
  ) {}

  push(chunk: OllamaChatResponse): StreamEvent[] {
    const events: StreamEvent[] = []
    if (!this.started) {
      this.started = true
      this.model = chunk.model || this.requestedModel
      events.push(this.messageStart(this.model))
    }
    this.raw += chunk.message.content
    if (this.settled) this.emitDelta(chunk.message.content, events)
    else this.settle(visibleText(this.raw), events)
    for (const call of chunk.message.tool_calls ?? []) {
      this.closeText(events)
      const parts = toolUse(call)
      this.calls.push(parts)
      const index = this.nextIndex++
      events.push(
        {
          type: 'content_block_start',
          index,
          content_block: {
            type: 'tool_use',
            id: parts.block.id,
            name: parts.block.name,
            input: {},
          },
        },
        {
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(parts.block.input) },
        },
        { type: 'content_block_stop', index },
      )
    }
    return events
  }

  /** Конец ответа: остаток текста, закрытие блоков, `message_delta` и `message_stop`. */
  finish(response: OllamaChatResponse): StreamEvent[] {
    const events: StreamEvent[] = []
    // Ответ из одних пробелов: до конца ждали, не окажется ли он началом `<think>`.
    if (!this.settled) this.settle(stripThinking(this.raw), events)
    // Без вызовов в полном сообщении есть текстовый блок, даже пустой — и в событиях тоже.
    if (this.nextIndex === 0) this.startText(events)
    this.closeText(events)
    events.push(
      {
        type: 'message_delta',
        context_management: null,
        delta: {
          container: null,
          stop_details: null,
          stop_reason: stopReason(this.calls.length > 0, response.done_reason),
          stop_sequence: null,
        },
        usage: {
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          fallback_credit: null,
          input_tokens: response.prompt_eval_count ?? null,
          iterations: null,
          output_tokens: response.eval_count ?? 0,
          output_tokens_details: null,
          server_tool_use: null,
        },
      },
      { type: 'message_stop' },
    )
    return events
  }

  private messageStart(model: string): StreamEvent {
    return {
      type: 'message_start',
      message: {
        id: this.messageId,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        container: null,
        context_management: null,
        diagnostics: null,
        stop_details: null,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          cache_creation: null,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          fallback_credit: null,
          inference_geo: null,
          input_tokens: 0,
          iterations: null,
          output_tokens: 0,
          output_tokens_details: null,
          server_tool_use: null,
          service_tier: null,
          speed: null,
        },
      },
    }
  }

  /** Первый видимый текст: с него ответ считается начавшимся (`settled`). */
  private settle(visible: string, events: StreamEvent[]): void {
    if (visible === '') return
    this.settled = true
    this.emitDelta(visible, events)
  }

  /**
   * Прирост текста. Текст после вызова инструмента открывает новый блок после `tool_use`, а в
   * полном `assistant` текст стоит первым; Qwen присылает `tool_calls` в конце ответа, так что
   * на практике порядок совпадает.
   */
  private emitDelta(text: string, events: StreamEvent[]): void {
    if (text === '') return
    const index = this.openText ?? this.startText(events)
    events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } })
  }

  private startText(events: StreamEvent[]): number {
    const index = this.nextIndex++
    this.openText = index
    events.push({
      type: 'content_block_start',
      index,
      content_block: { type: 'text', text: '', citations: null },
    })
    return index
  }

  private closeText(events: StreamEvent[]): void {
    if (this.openText === undefined) return
    events.push({ type: 'content_block_stop', index: this.openText })
    this.openText = undefined
  }
}

/**
 * Текст, который уже можно показать. Пока начало ответа может оказаться тегом `<think>`
 * (пробелы, `<thi`), не показывается ничего: иначе в `text_delta` попало бы рассуждение.
 */
function visibleText(raw: string): string {
  if ('<think>'.startsWith(raw.trimStart())) return ''
  return stripThinking(raw)
}
