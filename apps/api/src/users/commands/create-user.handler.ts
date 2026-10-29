import { ConflictException } from '@nestjs/common'
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs'
import type { User } from '../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { CreateUserCommand } from './create-user.command.js'

@CommandHandler(CreateUserCommand)
export class CreateUserHandler implements ICommandHandler<CreateUserCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ email, name, passwordHash }: CreateUserCommand): Promise<User> {
    try {
      return await this.prisma.user.create({ data: { email, name, passwordHash } })
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Пользователь с таким email уже существует')
      }
      throw error
    }
  }
}
