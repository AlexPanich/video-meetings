import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'
import { removeOrphanAvatars } from './orphan-avatars.js'

// как часто проверяются осиротевшие аватары (первый раз — при старте приложения)
export const ORPHAN_AVATARS_SWEEP_INTERVAL_MS = 10 * 60 * 1000

@Injectable()
export class OrphanAvatarsCleaner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrphanAvatarsCleaner.name)
  private timer?: NodeJS.Timeout

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.sweep()
    this.timer = setInterval(() => void this.sweep(), ORPHAN_AVATARS_SWEEP_INTERVAL_MS)
    this.timer.unref()
  }

  onModuleDestroy(): void {
    clearInterval(this.timer)
  }

  async sweep(): Promise<void> {
    try {
      await removeOrphanAvatars(this.prisma, this.logger)
    } catch (error) {
      this.logger.error(`Не удалось убрать осиротевшие файлы аватаров: ${String(error)}`)
    }
  }
}
