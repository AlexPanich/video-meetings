import { provider, query } from '@video-meetings/llm'
import type { SDKMessage } from '@video-meetings/llm'

// Контрактный сценарий «простой ответ»: одинаково проходит при LLM_PROVIDER=local
// (живая Ollama + Qwen) и LLM_PROVIDER=anthropic (Claude Agent SDK с ANTHROPIC_API_KEY).
describe.runIf(process.env.LLM_CONTRACT === '1')(`контракт: простой ответ (${provider})`, () => {
  it('query() отдаёт system/init, assistant с текстом и result/success', async () => {
    const messages: SDKMessage[] = []
    for await (const message of query({
      prompt: 'Как называется столица Франции? Ответь одним словом.',
      options: {
        systemPrompt: 'Ты отвечаешь кратко, без пояснений.',
        maxTurns: 1,
        tools: [],
      },
    })) {
      messages.push(message)
    }

    const init = messages[0]
    expect(init.type).toBe('system')
    if (init.type !== 'system' || init.subtype !== 'init') throw new Error('нет system/init')
    expect(init.session_id).toEqual(expect.any(String))

    const assistant = messages.find((m) => m.type === 'assistant')
    if (assistant?.type !== 'assistant') throw new Error('нет assistant')
    expect(assistant.message.content.some((block) => block.type === 'text')).toBe(true)

    const result = messages.at(-1)
    if (result?.type !== 'result' || result.subtype !== 'success') throw new Error('нет success')
    expect(result.result).toMatch(/париж|paris/i)
    expect(result.num_turns).toBeGreaterThanOrEqual(1)
    expect(result.session_id).toBe(init.session_id)
    if (provider === 'local') expect(result.total_cost_usd).toBe(0)
  })
})
