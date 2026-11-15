import { AbortError, provider, query } from '@video-meetings/llm'
import type { SDKMessage, SDKUserMessage } from '@video-meetings/llm'

// Контрактные сценарии фазы 3 «stream_event» и «отмена» (`interrupt()`, `abortController`):
// одинаково проходят при LLM_PROVIDER=local (живая Ollama + Qwen) и LLM_PROVIDER=anthropic
// (Claude Agent SDK с ANTHROPIC_API_KEY).

// Длинная генерация: без отмены она заняла бы десятки секунд.
const LONG_PROMPT =
  'Напиши очень подробный рассказ о путешествии по Европе, не меньше 3000 слов, по главам.'
// Отмена должна остановить генерацию намного раньше, чем она закончилась бы сама.
const CANCEL_DEADLINE_MS = 30_000

/** Поток из одного сообщения, который держится открытым, пока его не закроют. */
function openPrompt(text: string) {
  let close: () => void = () => {}
  const closed = new Promise<void>((resolve) => (close = resolve))
  async function* stream(): AsyncIterable<SDKUserMessage> {
    yield {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: '',
    }
    await closed
  }
  return { stream: stream(), close }
}

function textDeltas(messages: SDKMessage[]): string {
  let text = ''
  for (const message of messages) {
    if (message.type !== 'stream_event') continue
    const event = message.event
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text
    }
  }
  return text
}

function assistantText(messages: SDKMessage[]): string {
  let text = ''
  for (const message of messages) {
    if (message.type !== 'assistant') continue
    for (const block of message.message.content) if (block.type === 'text') text += block.text
  }
  return text
}

const succeeded = (messages: SDKMessage[]) =>
  messages.some((message) => message.type === 'result' && message.subtype === 'success')

describe.runIf(process.env.LLM_CONTRACT === '1')(
  `контракт: stream_event и отмена (${provider})`,
  () => {
    it('includePartialMessages даёт stream_event, из text_delta складывается ответ', async () => {
      const messages: SDKMessage[] = []
      for await (const message of query({
        prompt: 'Перечисли через запятую пять цветов радуги.',
        options: { tools: [], maxTurns: 1, includePartialMessages: true },
      })) {
        messages.push(message)
      }

      const types = messages.map((message) => message.type)
      expect(types).toContain('stream_event')
      // Все события потока ответа приходят до полного сообщения assistant.
      expect(types.lastIndexOf('stream_event')).toBeLessThan(types.indexOf('assistant'))
      const streamed = textDeltas(messages)
      expect(streamed.length).toBeGreaterThan(0)
      expect(streamed.trim()).toBe(assistantText(messages).trim())
      expect(succeeded(messages)).toBe(true)
    })

    it('interrupt() останавливает генерацию: ответа success нет', async () => {
      const prompt = openPrompt(LONG_PROMPT)
      const q = query({ prompt: prompt.stream, options: { tools: [], maxTurns: 1 } })
      const startedAt = Date.now()
      const timer = setTimeout(() => {
        // Сбой interrupt() не роняет прогон необработанным отказом: без остановки генерация дойдёт
        // до success, и тест упадёт на проверке ниже.
        void q
          .interrupt()
          .catch(() => undefined)
          .finally(() => prompt.close())
      }, 2000)

      const messages: SDKMessage[] = []
      try {
        for await (const message of q) {
          messages.push(message)
          // Оригинал после interrupt() отдаёт result хода и ждёт следующего сообщения.
          if (message.type === 'result') prompt.close()
        }
      } finally {
        clearTimeout(timer)
      }

      expect(Date.now() - startedAt).toBeLessThan(CANCEL_DEADLINE_MS)
      expect(succeeded(messages)).toBe(false)
    })

    it('abortController.abort() останавливает генерацию: AbortError, без success', async () => {
      const abortController = new AbortController()
      const startedAt = Date.now()
      const timer = setTimeout(() => abortController.abort(), 2000)

      const messages: SDKMessage[] = []
      let failure: unknown = null
      try {
        for await (const message of query({
          prompt: LONG_PROMPT,
          options: { tools: [], maxTurns: 1, abortController },
        })) {
          messages.push(message)
        }
      } catch (error) {
        failure = error
      } finally {
        clearTimeout(timer)
      }

      expect(abortController.signal.aborted).toBe(true)
      expect(Date.now() - startedAt).toBeLessThan(CANCEL_DEADLINE_MS)
      expect(succeeded(messages)).toBe(false)
      // Как оригинал: отмена abortController — исключение AbortError из генератора.
      expect(failure).toBeInstanceOf(AbortError)
    })
  },
)
