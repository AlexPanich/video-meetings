// Фасад LLM: код фич импортирует только этот пакет. Реализация выбирается один раз при загрузке
// модуля по LLM_PROVIDER: `local` (по умолчанию) — @video-meetings/llm-sdk поверх Ollama,
// `anthropic` — @anthropic-ai/claude-agent-sdk. Модуль Anthropic загружается только во втором
// случае, поэтому в режиме `local` он не импортируется и не делает запросов.
import type * as LocalSdk from '@video-meetings/llm-sdk'

export type {
  CallToolResult,
  CanUseTool,
  ContentBlock,
  ContextLimits,
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  HookJSONOutput,
  JsonSchemaOutputFormat,
  McpHttpServerConfig,
  McpSdkServerConfigWithInstance,
  McpServerConfig,
  McpSSEServerConfig,
  McpStdioServerConfig,
  OtherContentBlock,
  Options,
  OutputFormat,
  PermissionMode,
  PermissionResult,
  Query,
  SDKAssistantMessage,
  SDKControlInterruptResponse,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKPermissionDenial,
  SDKResultError,
  SDKResultMessage,
  SDKResultSuccess,
  SDKSystemMessage,
  SDKUserMessage,
  SdkMcpToolDefinition,
  SessionKey,
  SessionStore,
  SessionStoreEntry,
  StreamEvent,
  TextBlock,
  ToolUseBlock,
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
  AbortError: typeof LocalSdk.AbortError
  query: typeof LocalSdk.query
  tool: typeof LocalSdk.tool
  createSdkMcpServer: typeof LocalSdk.createSdkMcpServer
  InMemorySessionStore: typeof LocalSdk.InMemorySessionStore
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

/** Ошибка отмены через `options.abortController` (проверка — `instanceof AbortError`). */
export const AbortError = sdk.AbortError
/** Тип экземпляра: `catch (e) { … e is AbortError }`, как у класса оригинала. */
export type AbortError = InstanceType<typeof LocalSdk.AbortError>
export const query = sdk.query
export const tool = sdk.tool
export const createSdkMcpServer = sdk.createSdkMcpServer
/** Хранилище сессий в памяти процесса (`options.sessionStore`) — для тестов и разработки. */
export const InMemorySessionStore = sdk.InMemorySessionStore
export type InMemorySessionStore = InstanceType<typeof LocalSdk.InMemorySessionStore>

/**
 * Границы окна контекста `claude-agent-sdk`: SDK их не экспортирует. Окно Claude — 200 000
 * токенов, под ответ — 32 000 (максимум вывода моделей Claude по умолчанию), символов на токен —
 * как у локального SDK, консервативно.
 */
export const ANTHROPIC_CONTEXT_LIMITS: Readonly<LocalSdk.ContextLimits> = Object.freeze({
  numCtx: 200_000,
  outputReserveTokens: 32_000,
  inputTokens: 168_000,
  charsPerToken: 3,
})

/**
 * Границы окна контекста выбранной реализации: при `local` — те же, что использует локальный SDK
 * (`OLLAMA_NUM_CTX` читается при каждом вызове, некорректное значение — ошибка с именем
 * переменной), при `anthropic` — `ANTHROPIC_CONTEXT_LIMITS`. Расширение фасада: в оригинальном
 * SDK такой функции нет.
 */
export const contextLimits: () => LocalSdk.ContextLimits =
  provider === 'anthropic'
    ? () => ({ ...ANTHROPIC_CONTEXT_LIMITS })
    : await import('@video-meetings/llm-sdk').then((local) => () => local.contextLimits())
