import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common'
import { CommandBus, CommandHandler, type ICommandHandler, QueryBus } from '@nestjs/cqrs'
import { hashPassword, verifyPassword } from '../../auth/password.js'
import { type AuthResult, TokenService } from '../../auth/token.service.js'
import { ChangeUserPasswordCommand } from '../../users/commands/change-user-password.command.js'
import { FindUserByIdQuery } from '../../users/queries/find-user-by-id.query.js'
import { ChangePasswordCommand } from './change-password.command.js'

@CommandHandler(ChangePasswordCommand)
export class ChangePasswordHandler implements ICommandHandler<ChangePasswordCommand> {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly tokens: TokenService,
  ) {}

  async execute({
    userId,
    currentPassword,
    newPassword,
  }: ChangePasswordCommand): Promise<AuthResult> {
    const user = await this.queryBus.execute(new FindUserByIdQuery(userId))
    if (!user) throw new UnauthorizedException()
    // не 401: иначе BFF сбросит cookie и разлогинит пользователя из-за опечатки
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new ForbiddenException('Неверный текущий пароль')
    }
    if (newPassword === currentPassword) {
      throw new BadRequestException('Новый пароль должен отличаться от текущего')
    }
    const updated = await this.commandBus.execute(
      new ChangeUserPasswordCommand(userId, await hashPassword(newPassword), user.tokenVersion),
    )
    // пользователь удалён или пароль уже сменили параллельным запросом; 409, а не 401,
    // чтобы проигравший запрос не выглядел как сбой сессии
    if (!updated) throw new ConflictException('Пароль уже был изменён, повторите попытку')
    return this.tokens.issue(updated)
  }
}
