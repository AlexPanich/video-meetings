import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'
import { discardMeetingFile } from './discard-file.js'
import { removeOrphanFiles } from './orphan-files.js'

// запись, которая слишком долго остаётся в `uploading`, осталась от упавшего процесса;
// запас в несколько часов нужен, чтобы не прервать живую загрузку на очень медленном канале
export const STALE_UPLOAD_AGE_MS = 3 * 60 * 60 * 1000
// как часто проверяются зависшие загрузки (первый раз — при старте приложения)
export const STALE_UPLOAD_SWEEP_INTERVAL_MS = 10 * 60 * 1000

@Injectable()
export class StaleUploadsCleaner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(StaleUploadsCleaner.name)
  private timer?: NodeJS.Timeout

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.sweep()
    // периодическая проверка нужна, чтобы записи после падения и быстрого рестарта не висели вечно
    this.timer = setInterval(() => void this.sweep(), STALE_UPLOAD_SWEEP_INTERVAL_MS)
    this.timer.unref()
  }

  onModuleDestroy(): void {
    clearInterval(this.timer)
  }

  async sweep(): Promise<void> {
    try {
      const stale = await this.prisma.meetingFile.findMany({
        where: {
          status: 'uploading',
          createdAt: { lt: new Date(Date.now() - STALE_UPLOAD_AGE_MS) },
        },
      })
      for (const file of stale) await discardMeetingFile(this.prisma, file, this.logger)
      if (stale.length > 0) this.logger.log(`Закрыто зависших загрузок: ${stale.length}`)
      await removeOrphanFiles(this.prisma, this.logger)
    } catch (error) {
      this.logger.error(
        `Не удалось закрыть зависшие загрузки или убрать осиротевшие файлы: ${String(error)}`,
      )
    }
  }
}
