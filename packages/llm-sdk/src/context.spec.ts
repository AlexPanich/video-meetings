// Unit-тесты оценки бюджета контекста.
import { ContextBudget, ContextOverflowError } from './context.js'
import type { OllamaMessage } from './ollama.js'

const user = (content: string): OllamaMessage => ({ role: 'user', content })

describe('ContextBudget.calibrate', () => {
  it('уменьшает символы на токен по prompt_eval_count — оценка растёт', () => {
    const budget = new ContextBudget(32768, [])
    const messages = [user('a'.repeat(3000))]
    const before = budget.estimate(messages)

    // Ollama насчитала 1508 токенов на 3000 символов: ≈2 символа на токен.
    budget.calibrate(messages, 1508)

    expect(budget.estimate(messages)).toBe(1500 + 8)
    expect(budget.estimate(messages)).toBeGreaterThan(before)
  })

  it('не увеличивает символы на токен (Ollama могла обрезать вход)', () => {
    const budget = new ContextBudget(32768, [])
    const messages = [user('a'.repeat(3000))]
    const before = budget.estimate(messages)

    budget.calibrate(messages, 100)
    budget.calibrate(messages, undefined)

    expect(budget.estimate(messages)).toBe(before)
  })
})

describe('ContextBudget.fit', () => {
  it('сообщение пользователя больше бюджета — ContextOverflowError', () => {
    const budget = new ContextBudget(2048, [])
    expect(() => budget.fit([user('x'.repeat(10_000))])).toThrow(ContextOverflowError)
  })

  it('numPredict = num_ctx минус оценка входа, не меньше запаса под ответ', () => {
    const budget = new ContextBudget(4096, [])
    const messages = [user('a'.repeat(300))]

    const fitted = budget.fit(messages)

    expect(fitted.messages).toBe(messages)
    expect(fitted.numPredict).toBe(4096 - budget.estimate(messages))
    expect(fitted.numPredict).toBeGreaterThanOrEqual(budget.outputReserve)
  })
})
