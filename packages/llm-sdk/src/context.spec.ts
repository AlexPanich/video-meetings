// Unit-тесты оценки бюджета контекста.
import { ContextBudget, ContextOverflowError, contextLimits } from './context.js'
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
  it('диалог без инструментов не помещается — самые старые обмены заменяются пометкой', () => {
    const budget = new ContextBudget(2048, [])
    const messages: OllamaMessage[] = [
      { role: 'system', content: 'Ты помощник' },
      user('a'.repeat(2000)),
      { role: 'assistant', content: 'b'.repeat(2000) },
      user('c'.repeat(1000)),
      { role: 'assistant', content: 'd'.repeat(100) },
      user('Последний вопрос'),
    ]

    const fitted = budget.fit(messages)

    expect(fitted.messages[0]).toBe(messages[0])
    expect(fitted.messages[1].content).toMatch(/2 earlier messages .* omitted/)
    expect(fitted.messages.slice(2)).toEqual(messages.slice(3))
    expect(budget.estimate(fitted.messages)).toBeLessThanOrEqual(budget.inputTokens)
  })

  it('currentTurn: повтор внутри хода не делает его начало «старым ходом»', () => {
    const budget = new ContextBudget(2048, [])
    // текущий ход: сообщение с материалами, ответ модели и повтор по схеме — тоже `user`
    const messages: OllamaMessage[] = [
      user('m'.repeat(6000)),
      { role: 'assistant', content: 'не JSON' },
      user('Respond again with only a JSON value'),
    ]

    // без currentTurn повтор — «последний ход», а материалы убираются как прежние
    expect(budget.fit(messages).messages[0].content).toMatch(/earlier messages .* omitted/)
    // с началом хода материалы не убираются: не помещается — ошибка, а не ответ без материалов
    expect(() => budget.fit(messages, 0)).toThrow(ContextOverflowError)
  })

  it('currentTurn: прежние ходы до начала текущего по-прежнему убираются', () => {
    const budget = new ContextBudget(2048, [])
    const messages: OllamaMessage[] = [
      user('o'.repeat(6000)),
      { role: 'assistant', content: 'старый ответ' },
      user('Текущий вопрос'),
      { role: 'assistant', content: 'не JSON' },
      user('Respond again'),
    ]

    const fitted = budget.fit(messages, 2)

    expect(fitted.messages[0].content).toMatch(/2 earlier messages .* omitted/)
    expect(fitted.messages.slice(1)).toEqual(messages.slice(2))
  })

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

describe('contextLimits', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('совпадает с бюджетом query(): четверть окна под ответ, не больше 4096 токенов', () => {
    expect(contextLimits(8192)).toEqual({
      numCtx: 8192,
      outputReserveTokens: 2048,
      inputTokens: 6144,
      charsPerToken: 3,
    })
    expect(contextLimits(32_768)).toMatchObject({ outputReserveTokens: 4096, inputTokens: 28_672 })
    for (const numCtx of [1024, 8192, 32_768, 131_072]) {
      const budget = new ContextBudget(numCtx, [])
      expect(contextLimits(numCtx)).toMatchObject({
        outputReserveTokens: budget.outputReserve,
        inputTokens: budget.inputTokens,
      })
    }
  })

  it('по умолчанию — OLLAMA_NUM_CTX, некорректное значение — ошибка с именем переменной', () => {
    vi.stubEnv('OLLAMA_NUM_CTX', '16384')
    expect(contextLimits().numCtx).toBe(16_384)
    vi.stubEnv('OLLAMA_NUM_CTX', undefined)
    expect(contextLimits().numCtx).toBe(32_768)
    vi.stubEnv('OLLAMA_NUM_CTX', 'много')
    expect(() => contextLimits()).toThrow('OLLAMA_NUM_CTX must be a positive integer')
  })
})
