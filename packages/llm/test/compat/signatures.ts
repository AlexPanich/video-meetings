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
