import { Command } from '@nestjs/cqrs'

// Завершает все сессии пользователя (через RevokeUserTokens модуля users)
export class LogoutUserCommand extends Command<void> {
  constructor(public readonly userId: string) {
    super()
  }
}
