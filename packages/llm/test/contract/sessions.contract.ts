import { provider, query } from '@video-meetings/llm'
import type { Options } from '@video-meetings/llm'

// Контрактные сценарии фазы 4 «resume» и «forkSession»: одинаково проходят при LLM_PROVIDER=local
// (живая Ollama + Qwen) и LLM_PROVIDER=anthropic (Claude Agent SDK с ANTHROPIC_API_KEY).

// Слова модель знать не может: они есть только в предыдущих сообщениях сессии.
const FIRST = 'ЛИМОН-4271'
const SECOND = 'ГРУША-9054'
const ASK = 'Какое кодовое слово сейчас действует? Ответь только им, без пояснений.'

const OPTIONS: Options = {
  systemPrompt:
    'Ты помощник с памятью разговора. Когда просят запомнить кодовое слово, ответь «ок». ' +
    'Когда спрашивают кодовое слово, ответь последним названным словом, без пояснений.',
  // Отключает встроенные инструменты Claude Code (ФС, shell) в режиме anthropic
  tools: [],
  maxTurns: 1,
}

interface Answer {
  sessionId: string
  text: string
}

async function ask(prompt: string, options: Options = {}): Promise<Answer> {
  let answer: Answer | undefined
  for await (const message of query({ prompt, options: { ...OPTIONS, ...options } })) {
    if (message.type !== 'result') continue
    if (message.subtype !== 'success')
      throw new Error(`ожидался success, получен ${message.subtype}`)
    answer = { sessionId: message.session_id, text: message.result }
  }
  if (!answer) throw new Error('нет result')
  return answer
}

describe.runIf(process.env.LLM_CONTRACT === '1')(`контракт: сессии (${provider})`, () => {
  it('resume продолжает сессию с контекстом', async () => {
    const first = await ask(`Запомни кодовое слово ${FIRST}.`)

    const resumed = await ask(ASK, { resume: first.sessionId })

    expect(resumed.sessionId).toBe(first.sessionId)
    expect(resumed.text).toContain(FIRST)
  })

  it('forkSession создаёт новую сессию и не меняет исходную', async () => {
    const first = await ask(`Запомни кодовое слово ${FIRST}.`)

    const forked = await ask(`Кодовое слово изменилось, теперь оно ${SECOND}. Запомни его.`, {
      resume: first.sessionId,
      forkSession: true,
    })
    expect(forked.sessionId).not.toBe(first.sessionId)

    // Ответвление помнит своё слово…
    const inFork = await ask(ASK, { resume: forked.sessionId })
    expect(inFork.text).toContain(SECOND)

    // …а исходная сессия о нём не знает.
    const inOriginal = await ask(ASK, { resume: first.sessionId })
    expect(inOriginal.text).toContain(FIRST)
    expect(inOriginal.text).not.toContain(SECOND)
  })
})
