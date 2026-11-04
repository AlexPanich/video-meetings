import { Command } from '@nestjs/cqrs'
import type { User } from '../../generated/prisma/client.js'

// Атомарно меняет хеш и увеличивает tokenVersion, если хеш в БД всё ещё равен expectedHash
// (защита от гонки двух смен пароля). null — пользователя нет или хеш уже изменился
export class ChangeUserPasswordCommand extends Command<User | null> {
  constructor(
    public readonly userId: string,
    public readonly expectedHash: string,
    public readonly newHash: string,
  ) {
    super()
  }
}
