import { Query } from '@nestjs/cqrs'

// Версия сессий пользователя (`User.tokenVersion`) или null, если пользователя нет.
// Нужна гарду на каждом запросе, поэтому читает одно поле, а не всю строку с passwordHash.
export class GetUserTokenVersionQuery extends Query<number | null> {
  constructor(public readonly id: string) {
    super()
  }
}
