import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common'
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

    // не 401: иначе BFF сбросит cookie и разлогинит пользователя
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new BadRequestException('Неверный текущий пароль')
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException('Новый пароль должен отличаться от текущего')
    }

    const updated = await this.commandBus.execute(
      new ChangeUserPasswordCommand(userId, user.passwordHash, await hashPassword(newPassword)),
    )
    if (!updated) throw new ConflictException('Пароль был изменён одновременно, повторите попытку')
    return this.tokens.issue(updated)
  }
}
