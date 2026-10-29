import { UnauthorizedException } from '@nestjs/common'
import { type IQueryHandler, QueryBus, QueryHandler } from '@nestjs/cqrs'
import { FindUserByIdQuery } from '../../users/queries/find-user-by-id.query.js'
import { type PublicUser, toPublicUser } from '../../users/user.js'
import { GetCurrentUserQuery } from './get-current-user.query.js'

@QueryHandler(GetCurrentUserQuery)
export class GetCurrentUserHandler implements IQueryHandler<GetCurrentUserQuery> {
  constructor(private readonly queryBus: QueryBus) {}

  async execute({ userId }: GetCurrentUserQuery): Promise<PublicUser> {
    const user = await this.queryBus.execute(new FindUserByIdQuery(userId))
    if (!user) throw new UnauthorizedException()
    return toPublicUser(user)
  }
}
