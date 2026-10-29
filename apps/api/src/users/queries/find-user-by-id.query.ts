import { Query } from '@nestjs/cqrs'
import type { User } from '../../generated/prisma/client.js'

export class FindUserByIdQuery extends Query<User | null> {
  constructor(public readonly id: string) {
    super()
  }
}
