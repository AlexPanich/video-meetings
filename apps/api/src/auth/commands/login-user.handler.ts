import { UnauthorizedException } from '@nestjs/common'
import { CommandHandler, type ICommandHandler, QueryBus } from '@nestjs/cqrs'
import { FindUserByEmailQuery } from '../../users/queries/find-user-by-email.query.js'
import { hashPassword, verifyPassword } from '../password.js'
import { type AuthResult, TokenService } from '../token.service.js'
import { LoginUserCommand } from './login-user.command.js'

// Хеш для сравнения, когда пользователь не найден: выравнивает время ответа
const DUMMY_HASH = await hashPassword('dummy-password')

@CommandHandler(LoginUserCommand)
export class LoginUserHandler implements ICommandHandler<LoginUserCommand> {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly tokens: TokenService,
  ) {}

  async execute({ email, password }: LoginUserCommand): Promise<AuthResult> {
    const user = await this.queryBus.execute(new FindUserByEmailQuery(email))
    const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH)
    if (!user || !valid) {
      throw new UnauthorizedException('Неверный email или пароль')
    }
    return this.tokens.issue(user)
  }
}
