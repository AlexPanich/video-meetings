import { UnauthorizedException } from '@nestjs/common'
import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { type PublicUser, toPublicUser, UsersService } from '../../users/users.service.js'
import { GetCurrentUserQuery } from './get-current-user.query.js'

@QueryHandler(GetCurrentUserQuery)
export class GetCurrentUserHandler implements IQueryHandler<GetCurrentUserQuery> {
  constructor(private readonly users: UsersService) {}

  async execute({ userId }: GetCurrentUserQuery): Promise<PublicUser> {
    const user = await this.users.findById(userId)
    if (!user) throw new UnauthorizedException()
    return toPublicUser(user)
  }
}
