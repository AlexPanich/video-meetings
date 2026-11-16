import { SAMPLE_SUMMARY } from '../../test/support/llm-mock.js'
import { SummaryRunner } from './summary-runner.js'

const RESULT = { ...SAMPLE_SUMMARY, skippedFiles: [{ id: 'f-pdf', name: 'slides.pdf' }] }

const prismaMock = () => ({
  meetingSummary: {
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
})

type PrismaMock = ReturnType<typeof prismaMock>

// данные всех записей в `MeetingSummary` по порядку, независимо от того, через update или updateMany
const writes = (prisma: PrismaMock) =>
  [prisma.meetingSummary.update.mock, prisma.meetingSummary.updateMany.mock]
    .flatMap(({ calls, invocationCallOrder }) =>
      calls.map(([args], index) => ({
        order: invocationCallOrder[index],
        data: (args as { data: Record<string, unknown> }).data,
      })),
    )
    .sort((a, b) => a.order - b.order)
    .map(({ data }) => data)

const lastWrite = (prisma: PrismaMock) => writes(prisma).at(-1)

// агент, который ждёт отмены и тогда отвергает промис
const abortableAgent = () => ({
  run: vi.fn(
    (_meetingId: string, signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }),
  ),
})

describe('SummaryRunner', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('переводит задачу в generating, затем в done с результатом', async () => {
    const prisma = prismaMock()
    const agent = { run: vi.fn().mockResolvedValue(RESULT) }

    await new SummaryRunner(prisma as never, agent as never).run('meeting-1')

    expect(agent.run).toHaveBeenCalledWith('meeting-1', expect.any(AbortSignal))
    const statuses = writes(prisma).map((data) => data.status)
    expect(statuses).toEqual(['generating', 'done'])
    expect(lastWrite(prisma)).toMatchObject({ status: 'done', result: RESULT, error: null })
  })

  it('ошибка агента → failed с причиной, прежний результат не затирается', async () => {
    const prisma = prismaMock()
    const agent = { run: vi.fn().mockRejectedValue(new Error('Ollama is unreachable')) }

    await new SummaryRunner(prisma as never, agent as never).run('meeting-1')

    const failed = lastWrite(prisma)
    expect(failed).toMatchObject({ status: 'failed' })
    expect(failed?.error).toEqual(expect.any(String))
    expect(String(failed?.error).length).toBeGreaterThan(0)
    expect(failed).not.toHaveProperty('result')
  })

  it('таймаут задачи отменяет агента и помечает задачу failed', async () => {
    vi.stubEnv('SUMMARY_TIMEOUT_MS', '50')
    const prisma = prismaMock()
    const agent = abortableAgent()

    await new SummaryRunner(prisma as never, agent as never).run('meeting-1')

    const signal = agent.run.mock.calls[0][1]
    expect(signal.aborted).toBe(true)
    const failed = lastWrite(prisma)
    expect(failed).toMatchObject({ status: 'failed' })
    expect(String(failed?.error)).toMatch(/врем|таймаут|timeout/i)
    expect(failed).not.toHaveProperty('result')
  })

  it('таймаут срабатывает, даже если агент не реагирует на отмену', async () => {
    vi.stubEnv('SUMMARY_TIMEOUT_MS', '50')
    const prisma = prismaMock()
    const agent = { run: vi.fn(() => new Promise(() => {})) }

    const started = Date.now()
    await new SummaryRunner(prisma as never, agent as never).run('meeting-1')

    expect(Date.now() - started).toBeLessThan(2_000)
    expect(lastWrite(prisma)).toMatchObject({ status: 'failed' })
  })

  it('не падает, если БД недоступна при записи результата', async () => {
    const prisma = prismaMock()
    prisma.meetingSummary.update.mockRejectedValue(new Error('db down'))
    prisma.meetingSummary.updateMany.mockRejectedValue(new Error('db down'))
    const agent = { run: vi.fn().mockResolvedValue(RESULT) }

    await expect(
      new SummaryRunner(prisma as never, agent as never).run('meeting-1'),
    ).resolves.toBeUndefined()
  })

  it('отменяет текущие задачи при остановке приложения', async () => {
    const prisma = prismaMock()
    const agent = abortableAgent()
    const runner = new SummaryRunner(prisma as never, agent as never)

    const running = runner.run('meeting-1')
    await vi.waitFor(() => expect(agent.run).toHaveBeenCalled())
    await runner.onApplicationShutdown()
    await running

    expect(agent.run.mock.calls[0][1].aborted).toBe(true)
  })
})
