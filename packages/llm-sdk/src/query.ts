import { randomUUID } from 'node:crypto'
import { readOllamaConfig } from './config.js'
import { ContextBudget, ContextOverflowError } from './context.js'
import { chat, OllamaAbortedError } from './ollama.js'
import type { OllamaChatResponse, OllamaTool, OllamaToolCall } from './ollama.js'
import { runHooks } from './hooks.js'
import { matchesToolList } from './permissions.js'
import { hookBase, isRecord } from './session.js'
import type { QueryState, Session } from './session.js'
import { executeTool } from './tool-runner.js'
import type { ToolOutcome } from './tool-runner.js'
import { registerTools } from './tools.js'
import type { RegisteredTool } from './tools.js'
import type {
  AssistantMessage,
  ContentBlock,
  Options,
  PermissionMode,
  Query,
  SDKControlInterruptResponse,
  SDKMessage,
  SDKPermissionDenial,
  SDKResultError,
  SDKUserMessage,
  ToolUseBlock,
  Usage,
  UserMessageParam,
} from './types.js'

export interface QueryParams {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: Options
}

/**
 * Запускает сессию с моделью в Ollama. Отдаёт `system/init`, затем на каждое сообщение
 * пользователя — агентный цикл: `assistant`, при вызовах инструментов — `user` с их результатами
 * и следующий `assistant`, пока модель не ответит без инструментов или не кончатся `maxTurns`;
 * в конце — `result`. Строковый `prompt` — одно сообщение; `AsyncIterable` — цикл на каждое
 * сообщение с общей историей, пока поток не закончится.
 */
export function query({ prompt, options = {} }: QueryParams): Query {
  const state: QueryState = {
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
  const tools = availableTools(options)
  const ollamaTools: OllamaTool[] = tools.map((registered) => ({
    type: 'function',
    function: {
      name: registered.name,
      description: registered.description,
      parameters: registered.parameters,
    },
  }))
  const session: Session = {
    id: randomUUID(),
    config,
    model: options.model ?? config.model,
    options,
    state,
    history: [],
    context: new ContextBudget(config.numCtx, ollamaTools),
    tools: new Map(tools.map((registered) => [registered.name, registered])),
    ollamaTools,
  }
  const systemPrompt = joinSystemPrompt(options.systemPrompt)
  if (systemPrompt) session.history.push({ role: 'system', content: systemPrompt })

  yield {
    type: 'system',
    subtype: 'init',
    cwd: process.cwd(),
    tools: tools.map((registered) => registered.name),
    mcp_servers: Object.keys(options.mcpServers ?? {}).map((name) => ({
      name,
      status: 'connected',
    })),
    model: session.model,
    permissionMode: state.permissionMode,
    uuid: randomUUID(),
    session_id: session.id,
  }

  const signal = state.controller.signal
  try {
    await runHooks(
      options.hooks,
      'SessionStart',
      { ...hookBase(session), hook_event_name: 'SessionStart', source: 'startup' },
      'startup',
      undefined,
      signal,
    )
    for await (const userMessage of userTurns(prompt, signal)) {
      if (signal.aborted) return
      const completed = yield* agentLoop(session, textOf(userMessage))
      if (!completed) return
    }
  } finally {
    // Сессия кончилась: поток сообщений исчерпан, прервана, упала или вызывающий код вышел из цикла.
    await runHooks(
      options.hooks,
      'SessionEnd',
      { ...hookBase(session), hook_event_name: 'SessionEnd', reason: 'other' },
      'other',
      undefined,
      // После interrupt() signal сессии уже сработал, а хуку завершения нужно успеть доработать.
      new AbortController().signal,
    )
  }
}

/** Инструменты SDK-серверов без `disallowedTools`: запрещённые модель не видит. */
function availableTools(options: Options): RegisteredTool[] {
  return registerTools(options.mcpServers).filter(
    (registered) => !matchesToolList(registered, options.disallowedTools),
  )
}

/**
 * Агентный цикл на одно сообщение пользователя. Возвращает `false`, если сессию прервали
 * (`interrupt()`): тогда `result` не отдаётся.
 */
async function* agentLoop(session: Session, prompt: string): AsyncGenerator<SDKMessage, boolean> {
  const { config, state } = session
  const startedAt = performance.now()
  let apiMs = 0
  let turns = 0
  const usage: Usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
  const denials: SDKPermissionDenial[] = []
  await runHooks(
    session.options.hooks,
    'UserPromptSubmit',
    { ...hookBase(session), hook_event_name: 'UserPromptSubmit', prompt },
    undefined,
    undefined,
    state.controller.signal,
  )
  if (state.controller.signal.aborted) return false
  session.history.push({ role: 'user', content: prompt })

  // Для result: модель из последнего ответа и num_predict последнего запроса.
  let modelName = session.model
  let maxOutputTokens = session.context.outputReserve
  const resultBase = (stopReason: string | null) => ({
    type: 'result' as const,
    duration_ms: Math.round(performance.now() - startedAt),
    duration_api_ms: Math.round(apiMs),
    num_turns: turns,
    stop_reason: stopReason,
    total_cost_usd: 0,
    usage,
    modelUsage: {
      [modelName]: {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        webSearchRequests: 0,
        costUSD: 0,
        contextWindow: config.numCtx,
        maxOutputTokens,
      },
    },
    permission_denials: denials,
    uuid: randomUUID(),
    session_id: session.id,
  })

  while (true) {
    const requestStartedAt = performance.now()
    let fitted
    try {
      fitted = session.context.fit(session.history)
    } catch (error) {
      if (!(error instanceof ContextOverflowError)) throw error
      // Запрос не отправляется: Ollama молча отбросила бы часть входа.
      const overflow: SDKResultError = {
        ...resultBase(null),
        subtype: 'error_during_execution',
        is_error: true,
        errors: [error.message],
      }
      yield overflow
      return true
    }
    maxOutputTokens = fitted.numPredict
    let response: OllamaChatResponse
    try {
      response = await chat(config, {
        model: session.model,
        messages: fitted.messages,
        tools: session.ollamaTools,
        numPredict: fitted.numPredict,
        signal: state.controller.signal,
      })
    } catch (error) {
      if (error instanceof OllamaAbortedError) return false
      throw error
    }
    session.context.calibrate(fitted.messages, response.prompt_eval_count)
    apiMs += performance.now() - requestStartedAt
    turns += 1

    const text = stripThinking(response.message.content)
    const calls = (response.message.tool_calls ?? []).map(toolUse)
    session.history.push({
      role: 'assistant',
      content: text,
      ...(calls.length > 0 ? { tool_calls: calls.map((call) => call.ollama) } : {}),
    })
    const message = assistantMessage(
      response,
      session.model,
      text,
      calls.map((call) => call.block),
    )
    modelName = message.model
    addUsage(usage, message.usage)
    yield {
      type: 'assistant',
      message,
      parent_tool_use_id: null,
      uuid: randomUUID(),
      session_id: session.id,
    }

    if (calls.length === 0) {
      await runHooks(
        session.options.hooks,
        'Stop',
        {
          ...hookBase(session),
          hook_event_name: 'Stop',
          stop_hook_active: false,
          last_assistant_message: text,
        },
        undefined,
        undefined,
        state.controller.signal,
      )
      if (state.controller.signal.aborted) return false
      yield {
        ...resultBase(message.stop_reason),
        subtype: 'success' as const,
        result: text,
        is_error: false,
      }
      return true
    }

    const results: ToolOutcome[] = []
    for (const call of calls) {
      // interrupt() между сообщениями: инструменты (и их побочные эффекты) уже не выполняются.
      if (state.controller.signal.aborted) return false
      results.push(await executeTool(session, call.block, denials))
    }
    if (state.controller.signal.aborted) return false
    for (const [index, outcome] of results.entries()) {
      session.history.push({
        role: 'tool',
        content: outcome.text,
        tool_name: calls[index].block.name,
      })
    }
    yield {
      type: 'user',
      message: {
        role: 'user',
        content: results.map((outcome, index) => ({
          type: 'tool_result' as const,
          tool_use_id: calls[index].block.id,
          content: [{ type: 'text' as const, text: outcome.text }],
          is_error: outcome.isError,
        })),
      },
      parent_tool_use_id: null,
      tool_use_result: results.length === 1 ? results[0].raw : results.map((r) => r.raw),
      uuid: randomUUID(),
      session_id: session.id,
    }

    const maxTurns = session.options.maxTurns
    if (maxTurns !== undefined && turns >= maxTurns) {
      yield {
        ...resultBase(message.stop_reason),
        subtype: 'error_max_turns' as const,
        is_error: true,
        errors: [`Reached maximum number of turns (${maxTurns})`],
      }
      return true
    }
  }
}

/** Вызов инструмента из ответа Ollama: блок `tool_use` с новым id и вызов для истории. */
function toolUse(call: OllamaToolCall): { block: ToolUseBlock; ollama: OllamaToolCall } {
  const input = parseArguments(call.function.arguments)
  return {
    block: { type: 'tool_use', id: `toolu_${randomUUID()}`, name: call.function.name, input },
    ollama: { function: { name: call.function.name, arguments: input } },
  }
}

/** Аргументы-строка разбираются как JSON; не объект — пустой объект (схема его отклонит). */
function parseArguments(raw: OllamaToolCall['function']['arguments']): Record<string, unknown> {
  if (typeof raw !== 'string') return raw
  try {
    const value: unknown = JSON.parse(raw)
    return isRecord(value) ? value : {}
  } catch {
    return {}
  }
}

function addUsage(total: Usage, turn: Usage): void {
  total.input_tokens += turn.input_tokens
  total.output_tokens += turn.output_tokens
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
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
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
  toolUses: ToolUseBlock[],
): AssistantMessage {
  const usage: Usage = {
    input_tokens: response.prompt_eval_count ?? 0,
    output_tokens: response.eval_count ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
  // Без вызовов текстовый блок есть всегда (даже пустой), как в фазе 1; с вызовами — если есть текст.
  const content: ContentBlock[] =
    toolUses.length === 0 || text !== '' ? [{ type: 'text', text }, ...toolUses] : toolUses
  return {
    id: `msg_${randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model: response.model || requestedModel,
    content,
    stop_reason:
      toolUses.length > 0
        ? 'tool_use'
        : response.done_reason === 'length'
          ? 'max_tokens'
          : 'end_turn',
    stop_sequence: null,
    usage,
  }
}
