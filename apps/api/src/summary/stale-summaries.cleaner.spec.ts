import { StaleSummariesCleaner } from './stale-summaries.cleaner.js'

describe('StaleSummariesCleaner', () => {
  it('при старте api помечает задачи в pending/transcribing/generating как failed', async () => {
    const prisma = { meetingSummary: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) } }

    await new StaleSummariesCleaner(prisma as never).onApplicationBootstrap()

    expect(prisma.meetingSummary.updateMany).toHaveBeenCalledTimes(1)
    expect(prisma.meetingSummary.updateMany).toHaveBeenCalledWith({
      where: { status: { in: ['pending', 'transcribing', 'generating'] } },
      data: expect.objectContaining({ status: 'failed', error: expect.any(String) as string }) as {
        status: string
      },
    })
  })

  it('не трогает результат прошлого саммари', async () => {
    const prisma = { meetingSummary: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } }

    await new StaleSummariesCleaner(prisma as never).onApplicationBootstrap()

    const [{ data }] = prisma.meetingSummary.updateMany.mock.calls[0] as [
      { data: Record<string, unknown> },
    ]
    expect(data).not.toHaveProperty('result')
  })

  it('не роняет запуск приложения при ошибке БД', async () => {
    const prisma = {
      meetingSummary: { updateMany: vi.fn().mockRejectedValue(new Error('db down')) },
    }

    await expect(
      new StaleSummariesCleaner(prisma as never).onApplicationBootstrap(),
    ).resolves.toBeUndefined()
  })
})
