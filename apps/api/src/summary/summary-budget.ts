// Объём материалов встречи на один запрос к модели — от окна контекста, а не жёстко в байтах: по
// нему материалы упаковываются в запросы (один запрос или части map-reduce) и выжимки — в пачки
// объединения. Окно, резерв под ответ и оценку символов на токен даёт фасад (`contextLimits`): при
// `local` это те же числа, по которым локальный SDK проверяет запрос, при `anthropic` — окно Claude.
// Оценка грубая: запрос, который всё же не поместился, агент делит пополам (`summary-agent.ts`)
import { contextLimits, type ContextLimits } from '@video-meetings/llm'
import { SummaryError } from './summary.js'

// системный промпт, JSON Schema ответа, начало запроса и служебные токены сообщений
const PROMPT_OVERHEAD_TOKENS = 2000
// запас на заголовки блоков, экранирование и повторы по схеме (в повтор уходят прежний ответ и
// объяснение ошибки). Бюджет — в байтах UTF-8, а SDK считает символы: байт не меньше символа,
// поэтому оценка консервативна (кириллица — 2 байта на символ)
const SAFETY_SHARE = 0.75
// минимум больше длины символа UTF-8 (до 4 байт), иначе чтение могло бы не продвигаться
export const MIN_CHUNK_BYTES = 1024
// меньше — части по несколько строк: map-reduce из сотен запросов, выжимки которых не помещаются
// в объединение; задача падала бы от SDK или по лимиту частей с непонятной причиной
export const MIN_MATERIAL_BUDGET_BYTES = 8192
// окно, при котором бюджет не меньше минимума (проверяет тест) — его советуем в ошибке
export const RECOMMENDED_MIN_NUM_CTX = 8192

/** Окно модели для саммари; некорректный `OLLAMA_NUM_CTX` — `SummaryError` с именем переменной. */
export const summaryContextLimits = (): ContextLimits => {
  try {
    return contextLimits()
  } catch (error) {
    throw new SummaryError(
      'Некорректная настройка OLLAMA_NUM_CTX: нужно положительное целое число',
      {
        cause: error,
      },
    )
  }
}

/**
 * Байт материалов (текста файлов, транскриптов или выжимок), которые помещаются в один запрос.
 * Слишком маленькое окно — `SummaryError` с указанием на `OLLAMA_NUM_CTX`.
 */
export function materialBudgetBytes(limits: ContextLimits = summaryContextLimits()): number {
  const input = limits.inputTokens - PROMPT_OVERHEAD_TOKENS
  const budget = Math.floor(input * limits.charsPerToken * SAFETY_SHARE)
  if (budget < MIN_MATERIAL_BUDGET_BYTES) {
    throw new SummaryError(
      `OLLAMA_NUM_CTX слишком мал для саммари: окно ${limits.numCtx} токенов оставляет ` +
        `на материалы ${Math.max(0, budget)} байт при минимуме ${MIN_MATERIAL_BUDGET_BYTES}; ` +
        `задайте OLLAMA_NUM_CTX не меньше ${RECOMMENDED_MIN_NUM_CTX}`,
    )
  }
  return budget
}
