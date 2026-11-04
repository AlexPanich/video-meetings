import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ClearUserAvatarCommand, type ClearUserAvatarResult } from './clear-user-avatar.command.js'

@CommandHandler(ClearUserAvatarCommand)
export class ClearUserAvatarHandler implements ICommandHandler<ClearUserAvatarCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ userId }: ClearUserAvatarCommand): Promise<ClearUserAvatarResult | null> {
    // блокировка строки: параллельные PUT/DELETE выполняются по очереди и не теряют файл
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ avatarStorageName: string | null }[]>`
        SELECT "avatarStorageName" FROM "User" WHERE "id" = ${userId} FOR UPDATE`
      if (rows.length === 0) return null

      const previousStorageName = rows[0].avatarStorageName
      if (previousStorageName) {
        await tx.user.update({
          where: { id: userId },
          data: { avatarStorageName: null, avatarMimeType: null, avatarUpdatedAt: null },
        })
      }
      return { previousStorageName }
    })
  }
}
