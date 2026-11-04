import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs'
import type { User } from '../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ChangeUserPasswordCommand } from './change-user-password.command.js'

@CommandHandler(ChangeUserPasswordCommand)
export class ChangeUserPasswordHandler implements ICommandHandler<ChangeUserPasswordCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({
    userId,
    expectedHash,
    newHash,
  }: ChangeUserPasswordCommand): Promise<User | null> {
    try {
      return await this.prisma.user.update({
        where: { id: userId, passwordHash: expectedHash },
        data: { passwordHash: newHash, tokenVersion: { increment: 1 } },
      })
    } catch (error) {
      if ((error as { code?: string }).code === 'P2025') return null
      throw error
    }
  }
}
