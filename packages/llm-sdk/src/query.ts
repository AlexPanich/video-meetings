import { randomUUID } from 'node:crypto'
import { readOllamaConfig } from './config.js'
import { chat, OllamaAbortedError } from './ollama.js'
import type { OllamaChatResponse, OllamaMessage } from './ollama.js'
import type {
  AssistantMessage,
  Options,
  PermissionMode,
  Query,
  SDKControlInterruptResponse,
  SDKMessage,
  SDKUserMessage,
  Usage,
  UserMessageParam,
} from './types.js'

export interface QueryParams {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: Options
}

/**
 * Запускает сессию с моделью в Ollama. Отдаёт `system/init`, затем на каждое сообщение
 * пользователя — `assistant` и `result`. Строковый `prompt` — один ход; `AsyncIterable` —
 * ход на каждое сообщение с общей историей, пока поток не закончится.
 */
export function query({ prompt, options = {} }: QueryParams): Query {
  const state = {
    permissionMode: options.permissionMode ?? 'default',
    controller: new AbortController(),
  }
  const generator = run(prompt, options, state)

  return Object.assign(generator, {
    interrupt(): Promise<SDKControlInterruptResponse | undefined> {
      state.controller.abort()
      return Promise.resolve(undefined)
    },
    setPermissionMode(mode: PermissionMode): Promise<void> {
      state.permissionMode = mode
      return Promise.resolve()
    },
  })
}

interface QueryState {
  permissionMode: PermissionMode
  controller: AbortController
}

async function* run(
  prompt: QueryParams['prompt'],
  options: Options,
  state: QueryState,
): AsyncGenerator<SDKMessage, void> {
  const config = readOllamaConfig()
  if (options.tools && options.tools.length > 0) {
    throw new Error(
      `Built-in tools are not supported by the local SDK, pass tools: [] (got ${options.tools.join(', ')})`,
    )
  }
  const model = options.model ?? config.model
  const sessionId = randomUUID()
  const history: OllamaMessage[] = []
  const systemPrompt = joinSystemPrompt(options.systemPrompt)
  if (systemPrompt) history.push({ role: 'system', content: systemPrompt })

  yield {
    type: 'system',
    subtype: 'init',
    cwd: process.cwd(),
    tools: [],
    mcp_servers: [],
    model,
    permissionMode: state.permissionMode,
    uuid: randomUUID(),
    session_id: sessionId,
  }

  for await (const userMessage of userTurns(prompt, state.controller.signal)) {
    if (state.controller.signal.aborted) return
    const startedAt = performance.now()
    history.push({ role: 'user', content: textOf(userMessage) })

    let response: OllamaChatResponse
    try {
      response = await chat(config, { model, messages: history, signal: state.controller.signal })
    } catch (error) {
      if (error instanceof OllamaAbortedError) return
      throw error
    }
    const durationMs = Math.round(performance.now() - startedAt)

    const text = stripThinking(response.message.content)
    history.push({ role: 'assistant', content: text })
    const message = assistantMessage(response, model, text)

    yield {
      type: 'assistant',
      message,
      parent_tool_use_id: null,
      uuid: randomUUID(),
      session_id: sessionId,
    }
    yield {
      type: 'result',
      subtype: 'success',
      result: text,
      duration_ms: durationMs,
      duration_api_ms: durationMs,
      is_error: false,
      num_turns: 1,
      stop_reason: message.stop_reason,
      total_cost_usd: 0,
      usage: message.usage,
      modelUsage: {
        [message.model]: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          webSearchRequests: 0,
          costUSD: 0,
          contextWindow: config.numCtx,
          maxOutputTokens: config.numCtx,
        },
      },
      permission_denials: [],
      uuid: randomUUID(),
      session_id: sessionId,
    }
  }
}

/** Сообщения пользователя; ожидание следующего обрывается `interrupt()`. */
async function* userTurns(
  prompt: QueryParams['prompt'],
  signal: AbortSignal,
): AsyncGenerator<UserMessageParam> {
  if (typeof prompt === 'string') {
    yield { role: 'user', content: prompt }
    return
  }
  const iterator = prompt[Symbol.asyncIterator]()
  const aborted = new Promise<null>((resolve) => {
    if (signal.aborted) resolve(null)
    signal.addEventListener('abort', () => resolve(null), { once: true })
  })
  try {
    while (true) {
      const next = await Promise.race([iterator.next(), aborted])
      if (next === null || next.done) return
      yield next.value.message
    }
  } finally {
    // Сообщаем источнику, что больше не читаем (не ждём: он может висеть в своём next()).
    void iterator.return?.()?.catch(() => undefined)
  }
}

function textOf(message: UserMessageParam): string {
  if (typeof message.content === 'string') return message.content
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n\n')
}

function joinSystemPrompt(systemPrompt: Options['systemPrompt']): string {
  if (systemPrompt === undefined) return ''
  return typeof systemPrompt === 'string' ? systemPrompt : systemPrompt.join('\n\n')
}

/**
 * Qwen3 может вернуть рассуждение `<think>…</think>` в начале текста. Если ответ оборван внутри
 * рассуждения (нет `</think>`), отрезается всё: рассуждение не выдаётся за ответ.
 */
function stripThinking(content: string): string {
  return content.replace(/^\s*<think>[\s\S]*?(<\/think>\s*|$)/, '')
}

function assistantMessage(
  response: OllamaChatResponse,
  requestedModel: string,
  text: string,
): AssistantMessage {
  const usage: Usage = {
    input_tokens: response.prompt_eval_count ?? 0,
    output_tokens: response.eval_count ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
  return {
    id: `msg_${randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model: response.model || requestedModel,
    content: [{ type: 'text', text }],
    stop_reason: response.done_reason === 'length' ? 'max_tokens' : 'end_turn',
    stop_sequence: null,
    usage,
  }
}
