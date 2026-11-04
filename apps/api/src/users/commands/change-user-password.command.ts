import { Command } from '@nestjs/cqrs'
import type { User } from '../../generated/prisma/client.js'

// Атомарно меняет хеш пароля и увеличивает tokenVersion (прежние токены перестают действовать).
// expectedTokenVersion защищает от гонки: если версия уже сменилась, обновления не будет.
// Возвращает полную сущность (с passwordHash): команда внутренняя; null — пользователя нет
// или версия не совпала
export class ChangeUserPasswordCommand extends Command<User | null> {
  constructor(
    public readonly userId: string,
    public readonly passwordHash: string,
    public readonly expectedTokenVersion: number,
  ) {
    super()
  }
}
