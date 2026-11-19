import { randomUUID } from 'node:crypto'
import { AbortError } from './abort.js'
import { assistantMessage, stripThinking, toolUse } from './assistant.js'
import type { ToolUse } from './assistant.js'
import { readOllamaConfig } from './config.js'
import type { OllamaConfig } from './config.js'
import { ContextBudget, ContextOverflowError } from './context.js'
import { runHooks } from './hooks.js'
import { ExternalServers } from './mcp-clients.js'
import { chat, chatStream, OllamaAbortedError } from './ollama.js'
import type { ChatRequest, OllamaChatResponse, OllamaTool } from './ollama.js'
import { matchesToolList } from './permissions.js'
import { hookBase } from './session.js'
import type { QueryState, Session } from './session.js'
import { openSession, persistSession } from './sessions.js'
import type { SessionLink } from './sessions.js'
import { StreamTranslator } from './stream-events.js'
import {
  retryPrompt,
  STRUCTURED_OUTPUT_ATTEMPTS,
  structuredInstruction,
  structuredOutput,
} from './structured.js'
import type { StructuredOutput } from './structured.js'
import { executeTools } from './tool-runner.js'
import { registerTools } from './tools.js'
import type { RegisteredTool } from './tools.js'
import type {
  Options,
  PermissionMode,
  Query,
  SDKControlInterruptResponse,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKPermissionDenial,
  SDKResultError,
  SDKUserMessage,
  StreamEvent,
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
 * сообщение с общей историей, пока поток не закончится. `interrupt()` завершает генератор без
 * ошибки, `options.abortController` — исключением `AbortError`.
 */
export function query({ prompt, options = {} }: QueryParams): Query {
  const controller = new AbortController()
  const userSignal = options.abortController?.signal
  const state: QueryState = {
    permissionMode: options.permissionMode ?? 'default',
    controller,
    userSignal,
    signal: userSignal ? AbortSignal.any([controller.signal, userSignal]) : controller.signal,
  }
  const generator = run(prompt, options, state)

  return Object.assign(generator, {
    interrupt(): Promise<SDKControlInterruptResponse | undefined> {
      state.controller.abort()
      return Promise.resolve(undefined)
    },
    setPermissionMode(mode: PermissionMode): Promise<void> {
      if (mode === 'bypassPermissions' && !options.allowDangerouslySkipPermissions) {
        return Promise.reject(bypassWithoutFlagError())
      }
      state.permissionMode = mode
      return Promise.resolve()
    },
  })
}

/**
 * Оригинал включает `bypassPermissions` только вместе с `allowDangerouslySkipPermissions`.
 * Локально проверка та же, чтобы забытый флаг всплыл в разработке, а не в проде.
 */
function bypassWithoutFlagError(): Error {
  return new Error(
    "permissionMode 'bypassPermissions' requires allowDangerouslySkipPermissions: true",
  )
}

/**
 * Сессию остановили? Отмена через `abortController` — исключение `AbortError`; `interrupt()` —
 * `true`, и вызывающий выходит без `result`.
 */
function stopped(state: QueryState): boolean {
  if (state.userSignal?.aborted) throw new AbortError()
  return state.controller.signal.aborted
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
  if (options.permissionMode === 'bypassPermissions' && !options.allowDangerouslySkipPermissions) {
    throw bypassWithoutFlagError()
  }
  const structured = structuredOutput(options.outputFormat)
  // Неизвестный resume — ошибка до подключения серверов и запросов к модели.
  const link = await openSession(options, state.signal)
  const external = await ExternalServers.connect(options.mcpServers, state.signal)
  try {
    yield* runSession(prompt, options, state, config, structured, link, external)
  } finally {
    await external.close()
  }
}

async function* runSession(
  prompt: QueryParams['prompt'],
  options: Options,
  state: QueryState,
  config: OllamaConfig,
  structured: StructuredOutput | undefined,
  link: SessionLink,
  external: ExternalServers,
): AsyncGenerator<SDKMessage, void> {
  const tools = availableTools(options, external)
  const ollamaTools: OllamaTool[] = tools.map((registered) => ({
    type: 'function',
    function: {
      name: registered.name,
      description: registered.description,
      parameters: registered.parameters,
    },
  }))
  const session: Session = {
    id: link.id,
    config,
    model: options.model ?? config.model,
    options,
    state,
    history: link.history,
    // До `result`: вызывающий код часто выходит из цикла сразу на нём.
    persist: () => persistSession(link),
    context: new ContextBudget(config.numCtx, ollamaTools),
    tools: new Map(tools.map((registered) => [registered.name, registered])),
    ollamaTools,
    structured,
  }
  const systemPrompt = [
    joinSystemPrompt(options.systemPrompt),
    structured ? structuredInstruction(structured.schema) : '',
  ]
    .filter((part) => part !== '')
    .join('\n\n')
  // Системный промпт — из этого query(): в хранилище он не пишется и при resume не дублируется.
  if (systemPrompt) session.history.unshift({ role: 'system', content: systemPrompt })
  const source = link.resumed ? 'resume' : 'startup'

  yield {
    type: 'system',
    subtype: 'init',
    cwd: process.cwd(),
    tools: tools.map((registered) => registered.name),
    mcp_servers: Object.keys(options.mcpServers ?? {}).map((name) => ({
      name,
      status: external.status(name) ?? 'connected',
    })),
    model: session.model,
    permissionMode: state.permissionMode,
    uuid: randomUUID(),
    session_id: session.id,
  }

  const signal = state.signal
  try {
    if (stopped(state)) return
    await runHooks(
      options.hooks,
      'SessionStart',
      { ...hookBase(session), hook_event_name: 'SessionStart', source },
      source,
      undefined,
      signal,
    )
    const turns = { cancelled: false }
    for await (const userMessage of userTurns(prompt, signal, turns)) {
      if (stopped(state)) return
      const completed = yield* agentLoop(session, textOf(userMessage))
      if (!completed) return
    }
    // Ожидание следующего сообщения оборвала отмена: abortController — это ошибка. Отмена после
    // нормального конца сессии (уже отдан result) — не ошибка.
    if (turns.cancelled) stopped(state)
  } finally {
    // Сессия кончилась: поток сообщений исчерпан, прервана, упала или вызывающий код вышел из цикла.
    await runHooks(
      options.hooks,
      'SessionEnd',
      { ...hookBase(session), hook_event_name: 'SessionEnd', reason: 'other' },
      'other',
      undefined,
      // После отмены signal сессии уже сработал, а хуку завершения нужно успеть доработать.
      new AbortController().signal,
    )
  }
}

/** Инструменты SDK- и внешних серверов без `disallowedTools`: запрещённые модель не видит. */
function availableTools(options: Options, external: ExternalServers): RegisteredTool[] {
  return [...registerTools(options.mcpServers), ...external.tools()].filter(
    (registered) => !matchesToolList(registered, options.disallowedTools),
  )
}

/**
 * Агентный цикл на одно сообщение пользователя. Возвращает `false`, если сессию прервали
 * (`interrupt()`): тогда `result` не отдаётся. Отмена через `abortController` — `AbortError`.
 */
async function* agentLoop(session: Session, prompt: string): AsyncGenerator<SDKMessage, boolean> {
  const { config, state, structured } = session
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
    state.signal,
  )
  if (stopped(state)) return false
  // Начало хода: при переполнении контекста ход откатывается целиком.
  const turnStart = session.history.length
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
  const maxTurnsReached = (stopReason: string | null): SDKResultError | undefined => {
    const maxTurns = session.options.maxTurns
    if (maxTurns === undefined || turns < maxTurns) return undefined
    return {
      ...resultBase(stopReason),
      subtype: 'error_max_turns',
      is_error: true,
      errors: [`Reached maximum number of turns (${maxTurns})`],
    }
  }

  // Попытки ответа по схеме на это сообщение. После неудачной следующий запрос — повтор: с
  // `format` и без инструментов (Ollama ограничивает вывод грамматикой схемы, и вызов
  // инструмента всё равно невозможен).
  let structuredAttempts = 0
  let structuredRetry = false

  while (true) {
    const requestStartedAt = performance.now()
    let fitted
    try {
      fitted = session.context.fit(session.history, turnStart)
    } catch (error) {
      if (!(error instanceof ContextOverflowError)) throw error
      // Запрос не отправляется: Ollama молча отбросила бы часть входа. Ход не сохраняется и
      // убирается из истории: иначе каждое следующее сообщение сессии (и любой `resume`) снова
      // упиралось бы в то же слишком большое сообщение.
      const overflow: SDKResultError = {
        ...resultBase(null),
        subtype: 'error_during_execution',
        is_error: true,
        errors: [error.message],
      }
      session.history.length = turnStart
      yield overflow
      return true
    }
    maxOutputTokens = fitted.numPredict
    // С инструментами `format` не уходит: грамматика схемы не даёт модели их вызвать.
    const useFormat = structured && (structuredRetry || session.ollamaTools.length === 0)
    const request: ChatRequest = {
      model: session.model,
      messages: fitted.messages,
      tools: structuredRetry ? [] : session.ollamaTools,
      format: useFormat ? structured.schema : undefined,
      numPredict: fitted.numPredict,
      signal: state.signal,
    }
    const messageId = `msg_${randomUUID()}`
    let reply: ModelReply
    try {
      reply = yield* callModel(session, request, messageId)
    } catch (error) {
      if (error instanceof OllamaAbortedError && stopped(state)) return false
      throw error
    }
    // interrupt() во время отдачи последних stream_event: полного ответа уже не будет.
    if (stopped(state)) return false
    const { response, calls } = reply
    session.context.calibrate(fitted.messages, response.prompt_eval_count)
    apiMs += performance.now() - requestStartedAt
    turns += 1

    const text = stripThinking(reply.raw)
    session.history.push({
      role: 'assistant',
      content: text,
      ...(calls.length > 0 ? { tool_calls: calls.map((call) => call.ollama) } : {}),
    })
    const message = assistantMessage(
      response,
      messageId,
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
      const checked = structured?.check(text)
      if (checked && !checked.ok) {
        structuredAttempts += 1
        if (structuredAttempts >= STRUCTURED_OUTPUT_ATTEMPTS) {
          const exhausted: SDKResultError = {
            ...resultBase(message.stop_reason),
            subtype: 'error_max_structured_output_retries',
            is_error: true,
            errors: [
              `Model did not return output matching the JSON schema after ${structuredAttempts} attempts. ${checked.error}`,
            ],
          }
          await session.persist()
          yield exhausted
          return true
        }
        const limit = maxTurnsReached(message.stop_reason)
        if (limit) {
          await session.persist()
          yield limit
          return true
        }
        session.history.push({
          role: 'user',
          content: retryPrompt(checked.error, message.stop_reason === 'max_tokens'),
        })
        structuredRetry = true
        continue
      }
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
        state.signal,
      )
      if (stopped(state)) return false
      await session.persist()
      yield {
        ...resultBase(message.stop_reason),
        subtype: 'success' as const,
        result: text,
        ...(checked ? { structured_output: checked.value } : {}),
        is_error: false,
      }
      return true
    }

    const results = await executeTools(
      session,
      calls.map((call) => call.block),
      denials,
      () => stopped(state),
    )
    if (!results || stopped(state)) return false
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

    const limit = maxTurnsReached(message.stop_reason)
    if (limit) {
      await session.persist()
      yield limit
      return true
    }
  }
}

interface ModelReply {
  /** Ответ Ollama (для потока — последний чанк с моделью из первого): счётчики, причина остановки. */
  response: OllamaChatResponse
  /** Текст ответа как есть, с рассуждением. */
  raw: string
  calls: ToolUse[]
}

/**
 * Один запрос к модели. С `includePartialMessages` — потоком: по ходу отдаются `stream_event`,
 * id сообщения в них — `messageId` будущего `assistant`.
 */
async function* callModel(
  session: Session,
  request: ChatRequest,
  messageId: string,
): AsyncGenerator<SDKPartialAssistantMessage, ModelReply> {
  if (!session.options.includePartialMessages) {
    const response = await chat(session.config, request)
    return {
      response,
      raw: response.message.content,
      calls: (response.message.tool_calls ?? []).map(toolUse),
    }
  }
  const translator = new StreamTranslator(messageId, session.model)
  let last: OllamaChatResponse | undefined
  for await (const chunk of chatStream(session.config, request)) {
    for (const event of translator.push(chunk)) yield partial(session, event)
    last = chunk
  }
  // chatStream без `done` бросает: сюда доходит только полный ответ.
  if (!last) throw new Error('Ollama stream ended before the response was complete')
  for (const event of translator.finish(last)) yield partial(session, event)
  return {
    response: { ...last, model: translator.model },
    raw: translator.raw,
    calls: translator.calls,
  }
}

function partial(session: Session, event: StreamEvent): SDKPartialAssistantMessage {
  return {
    type: 'stream_event',
    event,
    parent_tool_use_id: null,
    uuid: randomUUID(),
    session_id: session.id,
  }
}

function addUsage(total: Usage, turn: Usage): void {
  total.input_tokens += turn.input_tokens
  total.output_tokens += turn.output_tokens
}

/** Сообщения пользователя; ожидание следующего обрывается отменой (`turns.cancelled`). */
async function* userTurns(
  prompt: QueryParams['prompt'],
  signal: AbortSignal,
  turns: { cancelled: boolean },
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
      if (next === null) {
        turns.cancelled = true
        return
      }
      if (next.done) return
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
