import { randomUUID } from 'node:crypto'
import { readOllamaConfig } from './config.js'
import { ContextBudget } from './context.js'
import type { OllamaConfig } from './config.js'
import { chat, OllamaAbortedError } from './ollama.js'
import type { OllamaChatResponse, OllamaMessage, OllamaTool, OllamaToolCall } from './ollama.js'
import { runHooks } from './hooks.js'
import { decidePermission, matchesToolList } from './permissions.js'
import { registerTools } from './tools.js'
import type { RegisteredTool } from './tools.js'
import type {
  AssistantMessage,
  BaseHookInput,
  CallToolResult,
  ContentBlock,
  Options,
  PermissionMode,
  Query,
  SDKControlInterruptResponse,
  SDKMessage,
  SDKPermissionDenial,
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

interface QueryState {
  permissionMode: PermissionMode
  controller: AbortController
}

/** Общие данные сессии для агентного цикла. */
interface Session {
  id: string
  config: OllamaConfig
  model: string
  options: Options
  state: QueryState
  /** Полная история; в запрос уходит её версия, усечённая `context`. */
  history: OllamaMessage[]
  context: ContextBudget
  tools: Map<string, RegisteredTool>
  ollamaTools: OllamaTool[]
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
  const session: Session = {
    id: randomUUID(),
    config,
    model: options.model ?? config.model,
    options,
    state,
    history: [],
    context: new ContextBudget(config.numCtx),
    tools: new Map(tools.map((registered) => [registered.name, registered])),
    ollamaTools: tools.map((registered) => ({
      type: 'function',
      function: {
        name: registered.name,
        description: registered.description,
        parameters: registered.parameters,
      },
    })),
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

/** Общие поля входа хуков. */
function hookBase(session: Session): BaseHookInput {
  return {
    session_id: session.id,
    transcript_path: '',
    cwd: process.cwd(),
    permission_mode: session.state.permissionMode,
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

  while (true) {
    const requestStartedAt = performance.now()
    const messages = session.context.fit(session.history, session.ollamaTools)
    let response: OllamaChatResponse
    try {
      response = await chat(config, {
        model: session.model,
        messages,
        tools: session.ollamaTools,
        signal: state.controller.signal,
      })
    } catch (error) {
      if (error instanceof OllamaAbortedError) return false
      throw error
    }
    session.context.calibrate(messages, session.ollamaTools, response.prompt_eval_count)
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
    addUsage(usage, message.usage)
    yield {
      type: 'assistant',
      message,
      parent_tool_use_id: null,
      uuid: randomUUID(),
      session_id: session.id,
    }

    const resultBase = () => ({
      type: 'result' as const,
      duration_ms: Math.round(performance.now() - startedAt),
      duration_api_ms: Math.round(apiMs),
      num_turns: turns,
      stop_reason: message.stop_reason,
      total_cost_usd: 0,
      usage,
      modelUsage: {
        [message.model]: {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          webSearchRequests: 0,
          costUSD: 0,
          contextWindow: config.numCtx,
          maxOutputTokens: config.numCtx,
        },
      },
      permission_denials: denials,
      uuid: randomUUID(),
      session_id: session.id,
    })

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
      yield { ...resultBase(), subtype: 'success' as const, result: text, is_error: false }
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
        ...resultBase(),
        subtype: 'error_max_turns' as const,
        is_error: true,
        errors: [`Reached maximum number of turns (${maxTurns})`],
      }
      return true
    }
  }
}

interface ToolOutcome {
  /** Текст для модели и для блока `tool_result`. */
  text: string
  isError: boolean
  /** `CallToolResult` обработчика (или описание ошибки) — `tool_use_result` сообщения. */
  raw: unknown
}

/**
 * Выполняет вызов: хуки `PreToolUse`, проверка прав, проверка аргументов по схеме, обработчик,
 * хуки `PostToolUse`. Неизвестный инструмент, отказ, неверные аргументы и исключение — ошибка для
 * модели (`is_error`), цикл продолжается. Отказ в правах попадает в `denials`.
 */
async function executeTool(
  session: Session,
  call: ToolUseBlock,
  denials: SDKPermissionDenial[],
): Promise<ToolOutcome> {
  const registered = session.tools.get(call.name)
  if (!registered) return toolError(`No such tool available: ${call.name}`)
  const { options, state } = session
  const signal = state.controller.signal
  const input = isRecord(call.input) ? call.input : {}

  const hookOutputs = await runHooks(
    options.hooks,
    'PreToolUse',
    {
      ...hookBase(session),
      hook_event_name: 'PreToolUse',
      tool_name: call.name,
      tool_input: input,
      tool_use_id: call.id,
    },
    call.name,
    call.id,
    signal,
  )
  const permission = await decidePermission(
    { options, permissionMode: state.permissionMode, signal },
    registered,
    call.id,
    input,
    hookOutputs,
  )
  if (!permission.allowed) {
    denials.push({ tool_name: call.name, tool_use_id: call.id, tool_input: input })
    return toolError(permission.message)
  }

  const parsed = registered.schema.safeParse(permission.input)
  if (!parsed.success) {
    return toolError(`Invalid input for ${call.name}: ${parsed.error.message}`)
  }
  let result: CallToolResult
  try {
    result = await registered.handler(parsed.data, { signal })
  } catch (error) {
    return toolError(`Tool ${call.name} failed: ${errorMessage(error)}`)
  }
  // Обработчик без типов (JS, приведение) может вернуть не CallToolResult — это ошибка инструмента.
  if (!isRecord(result) || !Array.isArray(result.content)) {
    return toolError(`Tool ${call.name} returned an invalid result: expected { content: [...] }`)
  }
  await runHooks(
    options.hooks,
    'PostToolUse',
    {
      ...hookBase(session),
      hook_event_name: 'PostToolUse',
      tool_name: call.name,
      tool_input: permission.input,
      tool_response: result,
      tool_use_id: call.id,
    },
    call.name,
    call.id,
    signal,
  )
  return { text: resultText(result), isError: result.isError === true, raw: result }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toolError(text: string): ToolOutcome {
  return { text, isError: true, raw: text }
}

/** Текст результата MCP: блоки `text` подряд, остальные — пометкой о типе. */
function resultText(result: CallToolResult): string {
  return result.content
    .map((block) => (block.type === 'text' ? block.text : `[${block.type}]`))
    .join('\n')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
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
