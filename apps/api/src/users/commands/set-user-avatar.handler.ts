import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs'
import { PrismaService } from '../../prisma/prisma.service.js'
import { SetUserAvatarCommand, type SetUserAvatarResult } from './set-user-avatar.command.js'

@CommandHandler(SetUserAvatarCommand)
export class SetUserAvatarHandler implements ICommandHandler<SetUserAvatarCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({
    userId,
    storageName,
    mimeType,
  }: SetUserAvatarCommand): Promise<SetUserAvatarResult | null> {
    // блокировка строки: два параллельных PUT читают прежнее имя строго по очереди,
    // поэтому ни один файл не остаётся на диске без записи
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ avatarStorageName: string | null }[]>`
        SELECT "avatarStorageName" FROM "User" WHERE "id" = ${userId} FOR UPDATE`
      if (rows.length === 0) return null

      const user = await tx.user.update({
        where: { id: userId },
        data: {
          avatarStorageName: storageName,
          avatarMimeType: mimeType,
          avatarUpdatedAt: new Date(),
        },
      })
      return { user, previousStorageName: rows[0].avatarStorageName }
    })
  }
}
