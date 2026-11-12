import type { OllamaConfig } from './config.js'

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Ответ `POST /api/chat` без стриминга (используемые поля). */
export interface OllamaChatResponse {
  model: string
  message: { role: string; content: string; thinking?: string }
  done: boolean
  done_reason?: string
  prompt_eval_count?: number
  eval_count?: number
}

export interface ChatRequest {
  model: string
  messages: OllamaMessage[]
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
        stream: false,
        options: { num_ctx: config.numCtx },
      }),
      signal,
    })
    if (!response.ok) {
      throw new Error(`Ollama responded with ${response.status}: ${await errorText(response)}`)
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
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`Ollama returned an unexpected response: ${text.slice(0, 200)}`)
  }
  const message = (body as { message?: { content?: unknown } } | null)?.message
  if (typeof message?.content !== 'string') {
    throw new Error(`Ollama returned an unexpected response: ${text.slice(0, 200)}`)
  }
  return body as OllamaChatResponse
}

async function errorText(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  try {
    const body = JSON.parse(text) as { error?: unknown }
    if (typeof body.error === 'string') return body.error
  } catch {
    // не JSON — отдаём текст как есть
  }
  return text.trim() || response.statusText || 'empty response'
}

function describeCause(error: TypeError): string {
  const cause = error.cause
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code
    return typeof code === 'string' ? code : cause.message
  }
  return error.message
}
