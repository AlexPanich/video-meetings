import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'
import { discardMeetingFile } from './discard-file.js'

// запись, которая слишком долго остаётся в `uploading`, осталась от упавшего процесса
export const STALE_UPLOAD_AGE_MS = 60 * 60 * 1000

@Injectable()
export class StaleUploadsCleaner implements OnApplicationBootstrap {
  private readonly logger = new Logger(StaleUploadsCleaner.name)

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const stale = await this.prisma.meetingFile.findMany({
        where: {
          status: 'uploading',
          createdAt: { lt: new Date(Date.now() - STALE_UPLOAD_AGE_MS) },
        },
      })
      for (const file of stale) await discardMeetingFile(this.prisma, file, this.logger)
      if (stale.length > 0) this.logger.log(`Закрыто зависших загрузок: ${stale.length}`)
    } catch (error) {
      this.logger.error(`Не удалось закрыть зависшие загрузки: ${String(error)}`)
    }
  }
}
