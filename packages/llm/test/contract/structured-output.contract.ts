import { createSdkMcpServer, provider, query, tool } from '@video-meetings/llm'
import type { SDKMessage } from '@video-meetings/llm'
import { z } from 'zod'

// Контрактные сценарии фазы 3 «structured_output по схеме» (без инструментов и вместе с
// SDK-инструментом, как у фич с `read_file` и `outputFormat`): одинаково проходят при
// LLM_PROVIDER=local (живая Ollama + Qwen) и LLM_PROVIDER=anthropic (Claude Agent SDK с ключом).

const SCHEMA = {
  type: 'object',
  properties: {
    city: { type: 'string', description: 'Столица' },
    country: { type: 'string', description: 'Страна' },
    population_millions: { type: 'number', description: 'Население столицы, млн' },
  },
  required: ['city', 'country', 'population_millions'],
  additionalProperties: false,
}

function isCapital(
  value: unknown,
): value is { city: string; country: string; population_millions: number } {
  if (typeof value !== 'object' || value === null) return false
  return (
    'city' in value &&
    typeof value.city === 'string' &&
    'country' in value &&
    typeof value.country === 'string' &&
    'population_millions' in value &&
    typeof value.population_millions === 'number'
  )
}

describe.runIf(process.env.LLM_CONTRACT === '1')(
  `контракт: structured_output (${provider})`,
  () => {
    it('outputFormat с JSON Schema — result/success со structured_output по схеме', async () => {
      const messages: SDKMessage[] = []
      for await (const message of query({
        prompt: 'Назови столицу Франции и её население.',
        options: {
          systemPrompt: 'Ты справочник по географии.',
          // Отключает встроенные инструменты Claude Code (ФС, shell) в режиме anthropic
          tools: [],
          maxTurns: 5,
          outputFormat: { type: 'json_schema', schema: SCHEMA },
        },
      })) {
        messages.push(message)
      }

      const result = messages.at(-1)
      if (result?.type !== 'result') throw new Error('последнее сообщение — не result')
      if (result.subtype !== 'success') throw new Error(`result/${result.subtype}`)
      const output = result.structured_output
      if (!isCapital(output)) throw new Error(`не по схеме: ${JSON.stringify(output)}`)
      expect(output.city).toMatch(/париж|paris/i)
      expect(output.country).toMatch(/франц|france/i)
      expect(output.population_millions).toBeGreaterThan(0)
    })

    it('outputFormat вместе с SDK-инструментом — инструмент вызван, structured_output по схеме', async () => {
      // Число модель знать не может: оно есть только в ответе инструмента.
      const calls: string[] = []
      const getPopulation = tool(
        'get_population',
        'Возвращает население города в миллионах человек',
        { city: z.string().describe('Название города') },
        async ({ city }) => {
          calls.push(city)
          return { content: [{ type: 'text', text: '7.31' }] }
        },
      )
      const server = createSdkMcpServer({
        name: 'stats',
        version: '1.0.0',
        tools: [getPopulation],
      })

      const messages: SDKMessage[] = []
      for await (const message of query({
        prompt:
          'Назови столицу Франции. Население узнай только инструментом get_population, не по памяти.',
        options: {
          systemPrompt: 'Ты справочник по географии. Население городов бери из get_population.',
          tools: [],
          mcpServers: { stats: server },
          allowedTools: ['mcp__stats__get_population'],
          maxTurns: 6,
          outputFormat: { type: 'json_schema', schema: SCHEMA },
        },
      })) {
        messages.push(message)
      }

      expect(calls.length).toBeGreaterThanOrEqual(1)
      const result = messages.at(-1)
      if (result?.type !== 'result') throw new Error('последнее сообщение — не result')
      if (result.subtype !== 'success') throw new Error(`result/${result.subtype}`)
      const output = result.structured_output
      if (!isCapital(output)) throw new Error(`не по схеме: ${JSON.stringify(output)}`)
      expect(output.city).toMatch(/париж|paris/i)
      expect(output.population_millions).toBeCloseTo(7.31, 2)
    })
  },
)
