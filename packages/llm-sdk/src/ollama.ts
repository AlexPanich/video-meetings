import type { OllamaConfig } from './config.js'

/** Вызов инструмента в сообщении модели. `arguments` — объект (иногда модель отдаёт строку JSON). */
export interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> | string }
}

export type OllamaMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: OllamaToolCall[] }
  | { role: 'tool'; content: string; tool_name: string }

/** Описание инструмента для tool calling (`tools` в `POST /api/chat`). */
export interface OllamaTool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

/** Ответ `POST /api/chat` без стриминга (используемые поля). */
export interface OllamaChatResponse {
  model: string
  message: { role: string; content: string; thinking?: string; tool_calls?: OllamaToolCall[] }
  done: boolean
  done_reason?: string
  prompt_eval_count?: number
  eval_count?: number
}

export interface ChatRequest {
  model: string
  messages: OllamaMessage[]
  /** Без инструментов поле `tools` в запрос не попадает. */
  tools?: OllamaTool[]
  /**
   * `options.num_predict`: предел длины ответа. Без него ответ не ограничен, и Ollama при выходе
   * за `num_ctx` молча сдвигает окно, отбрасывая начало входа.
   */
  numPredict?: number
  /** Внешняя отмена (`interrupt()`); таймаут из конфига добавляется сам. */
  signal?: AbortSignal
}

/** Запрос оборван внешним сигналом, а не таймаутом или сетью. */
export class OllamaAbortedError extends Error {
  constructor() {
    super('Ollama request was aborted')
    this.name = 'OllamaAbortedError'
  }
}

/** Один запрос `POST /api/chat`. Ошибки сети, таймаут и HTTP-статусы — понятные исключения. */
export async function chat(
  config: OllamaConfig,
  request: ChatRequest,
): Promise<OllamaChatResponse> {
  const timeout = AbortSignal.timeout(config.timeoutMs)
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout

  try {
    const response = await fetch(`${config.url}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        ...(request.tools?.length ? { tools: request.tools } : {}),
        stream: false,
        // Рассуждение Qwen3 занимает сотни токенов на ход и вытесняет контекст, а ответ не улучшает
        // ни для коротких ответов, ни для tool calling.
        think: false,
        options: {
          num_ctx: config.numCtx,
          ...(request.numPredict !== undefined ? { num_predict: request.numPredict } : {}),
        },
      }),
      signal,
    })
    if (!response.ok) {
      throw await httpError(response)
    }
    return parseChatResponse(await response.text())
  } catch (error) {
    if (request.signal?.aborted && error === request.signal.reason) throw new OllamaAbortedError()
    // Только ошибка самого таймаута: HTTP-ошибка, дочитанная уже после него, сохраняет статус.
    if (timeout.aborted && error === timeout.reason) {
      throw new Error(`Ollama request timed out after ${config.timeoutMs} ms`, { cause: error })
    }
    if (error instanceof TypeError) {
      throw new Error(`Ollama is unreachable at ${config.url}: ${describeCause(error)}`, {
        cause: error,
      })
    }
    throw error
  }
}

/** Проверяет форму ответа: прокси или сбой Ollama может вернуть 200 не с тем телом. */
function parseChatResponse(text: string): OllamaChatResponse {
  // Сырое тело (HTML прокси, внутренние адреса) — только в cause: текст ошибки может дойти до UI.
  const unexpected = () =>
    new Error('Ollama returned an unexpected response', { cause: text.slice(0, 500) })
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw unexpected()
  }
  const message = (body as { message?: { content?: unknown; tool_calls?: unknown } } | null)
    ?.message
  if (typeof message?.content !== 'string') throw unexpected()
  if (message.tool_calls !== undefined && !isToolCallList(message.tool_calls)) throw unexpected()
  return body as OllamaChatResponse
}

function isToolCallList(value: unknown): value is OllamaToolCall[] {
  return (
    Array.isArray(value) &&
    value.every((call: unknown) => {
      const fn = (call as { function?: { name?: unknown; arguments?: unknown } } | null)?.function
      return (
        typeof fn?.name === 'string' &&
        (typeof fn.arguments === 'string' ||
          (typeof fn.arguments === 'object' && fn.arguments !== null))
      )
    })
  )
}

/** HTTP-ошибка: в тексте — сообщение Ollama из `{ error }`, чужое тело (прокси) — только в cause. */
async function httpError(response: Response): Promise<Error> {
  const text = await response.text().catch(() => '')
  try {
    const body = JSON.parse(text) as { error?: unknown }
    if (typeof body.error === 'string') {
      return new Error(`Ollama responded with ${response.status}: ${body.error}`)
    }
  } catch {
    // не JSON — тело только в cause
  }
  return new Error(`Ollama responded with ${response.status} ${response.statusText}`.trim(), {
    cause: text.slice(0, 500),
  })
}

function describeCause(error: TypeError): string {
  const cause = error.cause
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code
    return typeof code === 'string' ? code : cause.message
  }
  return error.message
}
