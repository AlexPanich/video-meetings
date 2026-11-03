import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs'
import type { User } from '../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { UpdateUserNameCommand } from './update-user-name.command.js'

@CommandHandler(UpdateUserNameCommand)
export class UpdateUserNameHandler implements ICommandHandler<UpdateUserNameCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ userId, name }: UpdateUserNameCommand): Promise<User | null> {
    try {
      return await this.prisma.user.update({ where: { id: userId }, data: { name } })
    } catch (error) {
      if ((error as { code?: string }).code === 'P2025') return null
      throw error
    }
  }
}
