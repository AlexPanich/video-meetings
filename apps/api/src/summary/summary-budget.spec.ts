import { sliceChunk } from './summary-agent.js'
import {
  ANTHROPIC_CONTEXT_TOKENS,
  getNumCtx,
  materialBudgetBytes,
  MIN_CHUNK_BYTES,
} from './summary-budget.js'

describe('materialBudgetBytes', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('растёт вместе с num_ctx и оставляет место под промпт и ответ', () => {
    const small = materialBudgetBytes(8192)
    const large = materialBudgetBytes(32_768)
    expect(large).toBeGreaterThan(small * 3)
    // бюджет в байтах меньше окна в символах (≈ 3 на токен): место под промпт, ответ и запас
    expect(large).toBeLessThan(32_768 * 3)
  })

  it('не меньше минимальной части даже при крошечном окне', () => {
    expect(materialBudgetBytes(1024)).toBe(MIN_CHUNK_BYTES)
  })

  it('берёт num_ctx из OLLAMA_NUM_CTX, некорректное значение — по умолчанию', () => {
    vi.stubEnv('OLLAMA_NUM_CTX', '8192')
    expect(getNumCtx()).toBe(8192)
    expect(materialBudgetBytes()).toBe(materialBudgetBytes(8192))
    vi.stubEnv('OLLAMA_NUM_CTX', 'много')
    expect(getNumCtx()).toBe(32_768)
  })

  it('для anthropic — окно Claude, OLLAMA_NUM_CTX не влияет', () => {
    vi.stubEnv('OLLAMA_NUM_CTX', '8192')
    expect(getNumCtx('anthropic')).toBe(ANTHROPIC_CONTEXT_TOKENS)
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
