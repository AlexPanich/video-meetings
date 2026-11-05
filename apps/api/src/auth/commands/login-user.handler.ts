import { Logger, UnauthorizedException } from '@nestjs/common'
import { CommandBus, CommandHandler, type ICommandHandler, QueryBus } from '@nestjs/cqrs'
import { UpgradeUserPasswordHashCommand } from '../../users/commands/upgrade-user-password-hash.command.js'
import { FindUserByEmailQuery } from '../../users/queries/find-user-by-email.query.js'
import { hashPassword, needsRehash, verifyPassword } from '../password.js'
import { type AuthResult, TokenService } from '../token.service.js'
import { LoginUserCommand } from './login-user.command.js'

// Хеш для сравнения, когда пользователь не найден: выравнивает время ответа
const DUMMY_HASH = await hashPassword('dummy-password')

@CommandHandler(LoginUserCommand)
export class LoginUserHandler implements ICommandHandler<LoginUserCommand> {
  private readonly logger = new Logger(LoginUserHandler.name)

  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
    private readonly tokens: TokenService,
  ) {}

  async execute({ email, password }: LoginUserCommand): Promise<AuthResult> {
    const user = await this.queryBus.execute(new FindUserByEmailQuery(email))
    const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH)
    if (!user || !valid) {
      throw new UnauthorizedException('Неверный email или пароль')
    }
    if (needsRehash(user.passwordHash)) {
      await this.upgradeHash(user.id, user.passwordHash, password)
    }
    return this.tokens.issue(user)
  }

  // Усиление хеша не должно ломать вход: при сбое пароль перехешируется при следующем входе
  private async upgradeHash(userId: string, oldHash: string, password: string): Promise<void> {
    try {
      const newHash = await hashPassword(password)
      await this.commandBus.execute(new UpgradeUserPasswordHashCommand(userId, oldHash, newHash))
    } catch (error) {
      this.logger.error(
        `Не удалось обновить хеш пароля пользователя ${userId}`,
        error instanceof Error ? error.stack : String(error),
      )
    }
  }
}
