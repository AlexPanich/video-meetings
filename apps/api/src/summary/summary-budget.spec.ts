import { sliceChunk } from './summary-agent.js'
import { ANTHROPIC_CONTEXT_LIMITS, contextLimits, type ContextLimits } from '@video-meetings/llm'
import { SummaryError } from './summary.js'
import {
  materialBudgetBytes,
  MIN_MATERIAL_BUDGET_BYTES,
  RECOMMENDED_MIN_NUM_CTX,
} from './summary-budget.js'

const limitsFor = (numCtx: number): ContextLimits => {
  vi.stubEnv('OLLAMA_NUM_CTX', String(numCtx))
  return contextLimits()
}

describe('materialBudgetBytes', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('растёт вместе с num_ctx и оставляет место под промпт и ответ', () => {
    const small = materialBudgetBytes(limitsFor(8192))
    const large = materialBudgetBytes(limitsFor(32_768))
    expect(large).toBeGreaterThan(small * 3)
    // бюджет в байтах меньше входа SDK в символах: место под промпт и запас
    const { inputTokens, charsPerToken } = limitsFor(32_768)
    expect(large).toBeLessThan(inputTokens * charsPerToken)
  })

  it('резерв под ответ — из SDK: бюджет считается от inputTokens фасада', () => {
    const limits = limitsFor(32_768)
    const shrunk = { ...limits, inputTokens: limits.inputTokens - 1000 }
    expect(materialBudgetBytes(limits) - materialBudgetBytes(shrunk)).toBe(
      Math.floor(1000 * limits.charsPerToken * 0.75),
    )
  })

  it('берёт окно из OLLAMA_NUM_CTX через фасад', () => {
    vi.stubEnv('OLLAMA_NUM_CTX', '16384')
    expect(materialBudgetBytes()).toBe(materialBudgetBytes(limitsFor(16_384)))
  })

  it('некорректный OLLAMA_NUM_CTX — SummaryError с именем переменной', () => {
    vi.stubEnv('OLLAMA_NUM_CTX', 'много')
    expect(() => materialBudgetBytes()).toThrow(SummaryError)
    expect(() => materialBudgetBytes()).toThrow(/OLLAMA_NUM_CTX/)
  })

  it('маленький OLLAMA_NUM_CTX — SummaryError с указанием на настройку', () => {
    vi.stubEnv('OLLAMA_NUM_CTX', '4096')
    const error = (() => {
      try {
        materialBudgetBytes()
      } catch (caught) {
        return caught
      }
    })()
    expect(error).toBeInstanceOf(SummaryError)
    expect((error as Error).message).toMatch(
      new RegExp(
        `^OLLAMA_NUM_CTX слишком мал для саммари: окно 4096 токенов.*не меньше ${RECOMMENDED_MIN_NUM_CTX}$`,
      ),
    )
  })

  it(`рекомендуемое окно ${RECOMMENDED_MIN_NUM_CTX} проходит проверку`, () => {
    expect(materialBudgetBytes(limitsFor(RECOMMENDED_MIN_NUM_CTX))).toBeGreaterThanOrEqual(
      MIN_MATERIAL_BUDGET_BYTES,
    )
  })

  it('для anthropic — окно Claude из фасада', () => {
    expect(materialBudgetBytes(ANTHROPIC_CONTEXT_LIMITS)).toBeGreaterThan(
      materialBudgetBytes(limitsFor(32_768)) * 5,
    )
  })
})

describe('часть по границе строки (lineBreak)', () => {
  const text = Buffer.from('первая строка\nвторая строка')

  it('режет по последнему переводу строки во второй половине части', () => {
    const limit = Buffer.byteLength('первая строка\nвторая')
    expect(sliceChunk(text, 0, limit, true)).toMatchObject({
      content: 'первая строка\n',
      nextOffset: Buffer.byteLength('первая строка\n'),
      done: false,
    })
    // без флага — как раньше, по лимиту
    expect(sliceChunk(text, 0, limit).content).toBe('первая строка\nвторая')
  })

  it('последнюю часть и часть без перевода строки во второй половине не трогает', () => {
    expect(sliceChunk(text, 0, 1024, true).content).toBe(text.toString())
    const early = Buffer.from('a\nbcdefghijklmnopqrstuvwxyz')
    expect(sliceChunk(early, 0, 20, true).nextOffset).toBe(20)
  })

  it('смещение считается по байтам и для текста не в UTF-8', () => {
    // cp1251: каждый байт кириллицы при декодировании стал бы U+FFFD (3 байта)
    const cp1251 = Buffer.concat([
      Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]),
      Buffer.from('\nab'),
    ])
    const chunk = sliceChunk(cp1251, 0, 8, true)
    expect(chunk.nextOffset).toBe(7)
    expect(sliceChunk(cp1251, chunk.nextOffset, 8, true).content).toBe('ab')
  })
})
