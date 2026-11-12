// Проверка совместимости типов: «код фичи», который импортирует только фасад.
// Файл проходит `tsc` дважды (`pnpm --filter @video-meetings/llm typecheck:compat`):
// - tsconfig.compat.local.json — `@video-meetings/llm` указывает на `@video-meetings/llm-sdk`;
// - tsconfig.compat.anthropic.json — на `@anthropic-ai/claude-agent-sdk`.
// Без `any` и приведений типов. Каждая SDK-фаза дописывает сюда свои возможности.
import { query } from '@video-meetings/llm'
import type {
  Options,
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@video-meetings/llm'

export interface SimpleAnswer {
  sessionId: string
  model: string
  tools: string[]
  texts: string[]
  result: string | null
  numTurns: number
  durationMs: number
  costUsd: number
  inputTokens: number
  outputTokens: number
}

export async function simpleAnswer(prompt: string | AsyncIterable<SDKUserMessage>) {
  const options: Options = {
    model: 'qwen3:14b',
    systemPrompt: 'Отвечай кратко.',
  }
  const q: Query = query({ prompt, options })

  const answer: SimpleAnswer = {
    sessionId: '',
    model: '',
    tools: [],
    texts: [],
    result: null,
    numTurns: 0,
    durationMs: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
  }

  for await (const message of q) {
    handle(answer, message)
  }
  return answer
}

function handle(answer: SimpleAnswer, message: SDKMessage): void {
  if (message.type === 'system' && message.subtype === 'init') {
    answer.sessionId = message.session_id
    answer.model = message.model
    answer.tools = message.tools
  }
  if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text') answer.texts.push(block.text)
    }
  }
  if (message.type === 'result') handleResult(answer, message)
}

function handleResult(answer: SimpleAnswer, message: SDKResultMessage): void {
  answer.sessionId = message.session_id
  answer.numTurns = message.num_turns
  answer.durationMs = message.duration_ms
  answer.costUsd = message.total_cost_usd
  answer.inputTokens = message.usage.input_tokens
  answer.outputTokens = message.usage.output_tokens
  if (message.subtype === 'success') answer.result = message.result
}

export async function* userMessages(texts: string[]): AsyncIterable<SDKUserMessage> {
  for (const text of texts) {
    const message: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: '',
    }
    yield message
  }
}

export async function streamingAnswer(): Promise<SimpleAnswer> {
  return simpleAnswer(userMessages(['Привет']))
}

export async function interrupted(): Promise<void> {
  const q = query({ prompt: 'Привет' })
  await q.interrupt()
  await q.setPermissionMode('default')
}
