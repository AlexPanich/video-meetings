import { Command } from '@nestjs/cqrs'
import type { User } from '../../generated/prisma/client.js'

// Возвращает полную сущность (с passwordHash): команда внутренняя, для модуля profile;
// null — пользователя с таким id нет
export class UpdateUserNameCommand extends Command<User | null> {
  constructor(
    public readonly userId: string,
    public readonly name: string,
  ) {
    super()
  }
}
