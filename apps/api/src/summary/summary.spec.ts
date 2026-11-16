import { SUMMARY_JSON_SCHEMA, SummaryError } from './summary.js'
import { SummaryRunner } from './summary-runner.js'

const prismaMock = () => ({
  meetingSummary: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
})

const lastError = (prisma: ReturnType<typeof prismaMock>) =>
  (prisma.meetingSummary.updateMany.mock.calls.at(-1)?.[0] as { data: { error: string } }).data
    .error

describe('SUMMARY_JSON_SCHEMA', () => {
  it('требует все разделы и не допускает лишних полей', () => {
    expect(SUMMARY_JSON_SCHEMA).not.toHaveProperty('$schema')
    expect(SUMMARY_JSON_SCHEMA).toMatchObject({
      type: 'object',
      required: expect.arrayContaining([
        'summary',
        'decisions',
        'actionItems',
        'openQuestions',
      ]) as unknown,
      additionalProperties: false,
      properties: {
        actionItems: { items: { required: ['task'], additionalProperties: false } },
      },
    })
  })
})

describe('SummaryRunner: текст ошибки', () => {
  it('не показывает владельцу внутренние детали сбоя модели', async () => {
    const prisma = prismaMock()
    const agent = {
      run: vi
        .fn()
        .mockRejectedValue(
          new Error('Ollama is unreachable at http://10.0.0.5:11434: ECONNREFUSED'),
        ),
    }

    await new SummaryRunner(prisma as never, agent as never).run('meeting-1')

    expect(lastError(prisma)).not.toContain('10.0.0.5')
    expect(lastError(prisma).length).toBeGreaterThan(0)
  })

  it('показывает текст SummaryError как есть', async () => {
    const prisma = prismaMock()
    const agent = { run: vi.fn().mockRejectedValue(new SummaryError('Нет текстовых файлов')) }

    await new SummaryRunner(prisma as never, agent as never).run('meeting-1')

    expect(lastError(prisma)).toBe('Нет текстовых файлов')
  })
})
