import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'
import { ACTIVE_SUMMARY_STATUSES } from './summary.js'

/**
 * Задачи саммари выполняются в процессе api: после падения или рестарта активные задачи никто не
 * продолжит. При старте они помечаются `failed`, а прежний результат остаётся.
 */
@Injectable()
export class StaleSummariesCleaner implements OnApplicationBootstrap {
  private readonly logger = new Logger(StaleSummariesCleaner.name)

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const { count } = await this.prisma.meetingSummary.updateMany({
        where: { status: { in: [...ACTIVE_SUMMARY_STATUSES] } },
        data: { status: 'failed', error: 'Генерация саммари прервана перезапуском api' },
      })
      if (count > 0) this.logger.log(`Закрыто прерванных задач саммари: ${count}`)
    } catch (error) {
      this.logger.error(`Не удалось закрыть прерванные задачи саммари: ${String(error)}`)
    }
  }
}
