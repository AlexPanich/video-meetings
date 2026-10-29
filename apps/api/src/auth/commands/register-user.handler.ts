import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs'
import { UsersService } from '../../users/users.service.js'
import { hashPassword } from '../password.js'
import { type AuthResult, TokenService } from '../token.service.js'
import { RegisterUserCommand } from './register-user.command.js'

@CommandHandler(RegisterUserCommand)
export class RegisterUserHandler implements ICommandHandler<RegisterUserCommand> {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
  ) {}

  async execute({ email, password, name }: RegisterUserCommand): Promise<AuthResult> {
    const user = await this.users.create({
      email,
      name,
      passwordHash: await hashPassword(password),
    })
    return this.tokens.issue(user)
  }
}
