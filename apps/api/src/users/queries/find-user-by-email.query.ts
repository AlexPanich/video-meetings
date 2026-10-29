import { Query } from '@nestjs/cqrs'
import type { User } from '../../generated/prisma/client.js'

// Возвращает полную сущность (с passwordHash): запрос внутренний, для модуля auth
export class FindUserByEmailQuery extends Query<User | null> {
  constructor(public readonly email: string) {
    super()
  }
}
