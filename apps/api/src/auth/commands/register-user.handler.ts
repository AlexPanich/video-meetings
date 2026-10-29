import { CommandBus, CommandHandler, type ICommandHandler } from '@nestjs/cqrs'
import { CreateUserCommand } from '../../users/commands/create-user.command.js'
import { hashPassword } from '../password.js'
import { type AuthResult, TokenService } from '../token.service.js'
import { RegisterUserCommand } from './register-user.command.js'

@CommandHandler(RegisterUserCommand)
export class RegisterUserHandler implements ICommandHandler<RegisterUserCommand> {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly tokens: TokenService,
  ) {}

  async execute({ email, password, name }: RegisterUserCommand): Promise<AuthResult> {
    const user = await this.commandBus.execute(
      new CreateUserCommand(email, name, await hashPassword(password)),
    )
    return this.tokens.issue(user)
  }
}
