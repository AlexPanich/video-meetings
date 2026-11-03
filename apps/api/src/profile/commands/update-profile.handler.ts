import { UnauthorizedException } from '@nestjs/common'
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs'
import { PrismaService } from '../../prisma/prisma.service.js'
import { type PublicUser, toPublicUser } from '../../users/user.js'
import { UpdateProfileCommand } from './update-profile.command.js'

@CommandHandler(UpdateProfileCommand)
export class UpdateProfileHandler implements ICommandHandler<UpdateProfileCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ userId, name }: UpdateProfileCommand): Promise<PublicUser> {
    try {
      const user = await this.prisma.user.update({ where: { id: userId }, data: { name } })
      return toPublicUser(user)
    } catch (error) {
      // Пользователь из токена больше не существует
      if ((error as { code?: string }).code === 'P2025') throw new UnauthorizedException()
      throw error
    }
  }
}
