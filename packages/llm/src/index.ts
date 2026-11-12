// Фасад LLM: код фич импортирует только этот пакет. Реализация выбирается один раз при загрузке
// модуля по LLM_PROVIDER: `local` (по умолчанию) — @video-meetings/llm-sdk поверх Ollama,
// `anthropic` — @anthropic-ai/claude-agent-sdk. Модуль Anthropic загружается только во втором
// случае, поэтому в режиме `local` он не импортируется и не делает запросов.
import type * as LocalSdk from '@video-meetings/llm-sdk'

export type {
  ContentBlock,
  OtherContentBlock,
  Options,
  PermissionMode,
  Query,
  SDKAssistantMessage,
  SDKControlInterruptResponse,
  SDKMessage,
  SDKResultError,
  SDKResultMessage,
  SDKResultSuccess,
  SDKSystemMessage,
  SDKUserMessage,
  TextBlock,
} from '@video-meetings/llm-sdk'

export type LlmProvider = 'local' | 'anthropic'

export function resolveProvider(value: string | undefined): LlmProvider {
  const normalized = value?.trim() ?? ''
  if (normalized === '' || normalized === 'local') return 'local'
  if (normalized === 'anthropic') return 'anthropic'
  throw new Error(`LLM_PROVIDER must be "local" or "anthropic", got "${value}"`)
}

/** Набор функций, общий для обеих реализаций. Типы — локального SDK, они повторяют оригинал. */
interface Sdk {
  query: typeof LocalSdk.query
}

async function loadSdk(provider: LlmProvider): Promise<Sdk> {
  if (provider === 'anthropic') {
    // Формы типов совпадают по используемому подмножеству (проверяет test/compat), но объявлены
    // в разных пакетах, поэтому TypeScript не может сопоставить их напрямую.
    return (await import('@anthropic-ai/claude-agent-sdk')) as unknown as Sdk
  }
  return import('@video-meetings/llm-sdk')
}

export const provider: LlmProvider = resolveProvider(process.env.LLM_PROVIDER)

const sdk = await loadSdk(provider)

export const query = sdk.query
