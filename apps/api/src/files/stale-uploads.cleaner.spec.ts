import { STALE_UPLOAD_SWEEP_INTERVAL_MS, StaleUploadsCleaner } from './stale-uploads.cleaner.js'

describe('StaleUploadsCleaner', () => {
  it('помечает зависшие загрузки как failed', async () => {
    const stale = [{ id: 'f1', meetingId: 'm1', storageName: 'nonexistent-file' }]
    const prisma = {
      meetingFile: {
        findMany: vi.fn().mockResolvedValue(stale),
        update: vi.fn().mockResolvedValue({}),
      },
    }

    await new StaleUploadsCleaner(prisma as never).onApplicationBootstrap()

    expect(prisma.meetingFile.findMany).toHaveBeenCalledWith({
      where: { status: 'uploading', createdAt: { lt: expect.any(Date) as Date } },
    })
    expect(prisma.meetingFile.update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: { status: 'failed' },
    })
  })

  it('не роняет запуск приложения при ошибке БД', async () => {
    const prisma = { meetingFile: { findMany: vi.fn().mockRejectedValue(new Error('db down')) } }

    await expect(
      new StaleUploadsCleaner(prisma as never).onApplicationBootstrap(),
    ).resolves.toBeUndefined()
  })

  it('повторяет проверку по таймеру и останавливается при завершении модуля', async () => {
    vi.useFakeTimers()
    try {
      const prisma = { meetingFile: { findMany: vi.fn().mockResolvedValue([]) } }
      const cleaner = new StaleUploadsCleaner(prisma as never)

      await cleaner.onApplicationBootstrap()
      expect(prisma.meetingFile.findMany).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(STALE_UPLOAD_SWEEP_INTERVAL_MS)
      expect(prisma.meetingFile.findMany).toHaveBeenCalledTimes(2)

      cleaner.onModuleDestroy()
      await vi.advanceTimersByTimeAsync(STALE_UPLOAD_SWEEP_INTERVAL_MS * 3)
      expect(prisma.meetingFile.findMany).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
