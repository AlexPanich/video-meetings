import { Query } from '@nestjs/cqrs'
import type { PublicUser } from '../../users/user.js'

export class GetCurrentUserQuery extends Query<PublicUser> {
  constructor(public readonly userId: string) {
    super()
  }
}
