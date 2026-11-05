import { CommandBus, CommandHandler, type ICommandHandler } from '@nestjs/cqrs'
import { RevokeUserTokensCommand } from '../../users/commands/revoke-user-tokens.command.js'
import { LogoutUserCommand } from './logout-user.command.js'

@CommandHandler(LogoutUserCommand)
export class LogoutUserHandler implements ICommandHandler<LogoutUserCommand> {
  constructor(private readonly commandBus: CommandBus) {}

  async execute({ userId }: LogoutUserCommand): Promise<void> {
    await this.commandBus.execute(new RevokeUserTokensCommand(userId))
  }
}
