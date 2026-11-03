import { UnauthorizedException } from '@nestjs/common'
import { CommandBus, CommandHandler, type ICommandHandler } from '@nestjs/cqrs'
import { UpdateUserNameCommand } from '../../users/commands/update-user-name.command.js'
import { type PublicUser, toPublicUser } from '../../users/user.js'
import { UpdateProfileCommand } from './update-profile.command.js'

@CommandHandler(UpdateProfileCommand)
export class UpdateProfileHandler implements ICommandHandler<UpdateProfileCommand> {
  constructor(private readonly commandBus: CommandBus) {}

  async execute({ userId, name }: UpdateProfileCommand): Promise<PublicUser> {
    const user = await this.commandBus.execute(new UpdateUserNameCommand(userId, name))
    // Пользователь из токена больше не существует
    if (!user) throw new UnauthorizedException()
    return toPublicUser(user)
  }
}
