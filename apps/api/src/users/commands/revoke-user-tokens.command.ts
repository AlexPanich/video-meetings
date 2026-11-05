import { Command } from '@nestjs/cqrs'

// Увеличивает User.tokenVersion: все выданные токены пользователя перестают действовать.
// Возвращает false, если пользователя нет
export class RevokeUserTokensCommand extends Command<boolean> {
  constructor(public readonly userId: string) {
    super()
  }
}
