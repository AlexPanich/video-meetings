// Сверка сигнатур локального SDK с опорной версией @anthropic-ai/claude-agent-sdk.
// Фасад приводит модуль Anthropic к локальным типам (`as unknown as Sdk` в src/index.ts), и
// без этой проверки обновление опорной версии могло бы молча разойтись с локальными типами.
// Ошибка компиляции здесь означает расхождение: поправьте локальные типы или README.
import type * as Anthropic from '@anthropic-ai/claude-agent-sdk'
import type * as Local from '@video-meetings/llm-sdk'

type Assert<T extends true> = T
type Assignable<From, To> = [From] extends [To] ? true : false

// Всё, что код фичи может передать в query() через фасад, принимает и оригинал.
export type ParamsToAnthropic = Assert<
  Assignable<Parameters<typeof Local.query>[0], Parameters<typeof Anthropic.query>[0]>
>
export type OptionsToAnthropic = Assert<Assignable<Local.Options, Anthropic.Options>>
export type UserMessageToAnthropic = Assert<
  Assignable<Local.SDKUserMessage, Anthropic.SDKUserMessage>
>

// Методы Query оригинала подходят под локальные объявления.
export type InterruptFromAnthropic = Assert<
  Assignable<Anthropic.Query['interrupt'], Local.Query['interrupt']>
>
export type SetPermissionModeFromAnthropic = Assert<
  Assignable<Anthropic.Query['setPermissionMode'], Local.Query['setPermissionMode']>
>

// Фасад отдаёт tool и createSdkMcpServer оригинала под локальными типами: функции оригинала должны
// подходить под локальные объявления.
export type ToolFromAnthropic = Assert<Assignable<typeof Anthropic.tool, typeof Local.tool>>
export type CreateSdkMcpServerFromAnthropic = Assert<
  Assignable<typeof Anthropic.createSdkMcpServer, typeof Local.createSdkMcpServer>
>

// Сообщение Claude Agent SDK с тем же type подходит под локальный тип: код фичи, написанный по
// локальным типам, читает только существующие поля. Локальные типы объявляют подмножество полей
// и вариантов; у оригинала десятки вариантов SDKMessage (stream_event, system/status и др.),
// поэтому switch по message.type в коде фич обязан иметь default.
type AnthropicMessage<T> = Extract<Anthropic.SDKMessage, T>
export type AssistantFromAnthropic = Assert<
  Assignable<AnthropicMessage<{ type: 'assistant' }>, Local.SDKAssistantMessage>
>
export type ResultFromAnthropic = Assert<
  Assignable<AnthropicMessage<{ type: 'result' }>, Local.SDKResultMessage>
>
export type InitFromAnthropic = Assert<
  Assignable<AnthropicMessage<{ type: 'system'; subtype: 'init' }>, Local.SDKSystemMessage>
>
export type UserFromAnthropic = Assert<
  Assignable<AnthropicMessage<{ type: 'user' }>, Local.SDKUserMessage>
>
export type PartialFromAnthropic = Assert<
  Assignable<AnthropicMessage<{ type: 'stream_event' }>, Local.SDKPartialAssistantMessage>
>

// Фаза 3: формат структурированного ответа и класс ошибки отмены (`abortController`).
export type OutputFormatToAnthropic = Assert<
  Assignable<Local.OutputFormat, NonNullable<Anthropic.Options['outputFormat']>>
>
export type AbortErrorFromAnthropic = Assert<
  Assignable<typeof Anthropic.AbortError, typeof Local.AbortError>
>

// Фаза 4: хранилище сессий в обе стороны, опции сессий и конфиги внешних MCP-серверов.
export type SessionStoreToAnthropic = Assert<Assignable<Local.SessionStore, Anthropic.SessionStore>>
export type SessionStoreFromAnthropic = Assert<
  Assignable<Anthropic.SessionStore, Local.SessionStore>
>
export type InMemoryStoreFromAnthropic = Assert<
  Assignable<
    InstanceType<typeof Anthropic.InMemorySessionStore>,
    Pick<Local.InMemorySessionStore, keyof Local.SessionStore>
  >
>
export type McpServerConfigToAnthropic = Assert<
  Assignable<Local.McpServerConfig, NonNullable<Anthropic.Options['mcpServers']>[string]>
>
