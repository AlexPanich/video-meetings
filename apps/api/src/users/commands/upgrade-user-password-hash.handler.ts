import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs'
import { PrismaService } from '../../prisma/prisma.service.js'
import { UpgradeUserPasswordHashCommand } from './upgrade-user-password-hash.command.js'

@CommandHandler(UpgradeUserPasswordHashCommand)
export class UpgradeUserPasswordHashHandler implements ICommandHandler<UpgradeUserPasswordHashCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({
    userId,
    oldPasswordHash,
    newPasswordHash,
  }: UpgradeUserPasswordHashCommand): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id: userId, passwordHash: oldPasswordHash },
      data: { passwordHash: newPasswordHash },
    })
  }
}
