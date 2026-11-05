import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs'
import { PrismaService } from '../../prisma/prisma.service.js'
import { RevokeUserTokensCommand } from './revoke-user-tokens.command.js'

@CommandHandler(RevokeUserTokensCommand)
export class RevokeUserTokensHandler implements ICommandHandler<RevokeUserTokensCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ userId }: RevokeUserTokensCommand): Promise<boolean> {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
        select: { id: true },
      })
      return true
    } catch (error) {
      if ((error as { code?: string }).code === 'P2025') return false
      throw error
    }
  }
}
