// Объём материалов встречи на один запрос к модели — от окна контекста, а не жёстко в байтах:
// с ним сравнивается сумма источников (один проход агента или map-reduce), им же ограничены часть
// файла в `read_file` и часть текста в map-reduce
import { provider, type LlmProvider } from '@video-meetings/llm'

// как у Ollama и локального SDK: без `OLLAMA_NUM_CTX` — 32768 токенов
export const DEFAULT_NUM_CTX = 32_768
// окно Claude (`LLM_PROVIDER=anthropic`): `OLLAMA_NUM_CTX` к нему не относится
export const ANTHROPIC_CONTEXT_TOKENS = 200_000
// под ответ модели локальный SDK оставляет четверть окна, но не больше 4096 токенов
// (`llm-sdk/src/context.ts`; SDK эти числа не экспортирует — при их смене поправить здесь)
const OUTPUT_RESERVE_SHARE = 0.25
const OUTPUT_RESERVE_MAX_TOKENS = 4096
// системный промпт, JSON Schema ответа, описания инструментов и служебные токены сообщений
const PROMPT_OVERHEAD_TOKENS = 2000
// оценка SDK — 3 символа на токен; байт UTF-8 не меньше символа, поэтому бюджет в байтах
// консервативен (кириллица — 2 байта на символ)
const CHARS_PER_TOKEN = 3
// запас на JSON-обёртку результатов инструментов (экранирование, поля ответа) и повторы по схеме
const SAFETY_SHARE = 0.75
// минимум больше длины символа UTF-8 (до 4 байт), иначе чтение могло бы не продвигаться
export const MIN_CHUNK_BYTES = 1024

// env читается при каждом запуске, чтобы значение можно было менять в тестах; некорректное
// `OLLAMA_NUM_CTX` — как без переменной (сам SDK на нём упадёт с понятной ошибкой)
export const getNumCtx = (llmProvider: LlmProvider = provider) => {
  if (llmProvider === 'anthropic') return ANTHROPIC_CONTEXT_TOKENS
  const value = Number(process.env.OLLAMA_NUM_CTX)
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_NUM_CTX
}

/** Байт материалов (текста файлов, транскриптов или выжимок), которые помещаются в один запрос. */
export function materialBudgetBytes(numCtx = getNumCtx()): number {
  const output = Math.min(OUTPUT_RESERVE_MAX_TOKENS, Math.floor(numCtx * OUTPUT_RESERVE_SHARE))
  const input = numCtx - output - PROMPT_OVERHEAD_TOKENS
  return Math.max(MIN_CHUNK_BYTES, Math.floor(input * CHARS_PER_TOKEN * SAFETY_SHARE))
}
