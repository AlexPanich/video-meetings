import { Command } from '@nestjs/cqrs'
import type { User } from '../../generated/prisma/client.js'

// Возвращает полную сущность (с passwordHash): команда внутренняя, для модуля auth
export class CreateUserCommand extends Command<User> {
  constructor(
    public readonly email: string,
    public readonly name: string,
    public readonly passwordHash: string,
  ) {
    super()
  }
}
