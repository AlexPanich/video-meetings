import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import type { User } from '../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { FindUserByEmailQuery } from './find-user-by-email.query.js'

@QueryHandler(FindUserByEmailQuery)
export class FindUserByEmailHandler implements IQueryHandler<FindUserByEmailQuery> {
  constructor(private readonly prisma: PrismaService) {}

  execute({ email }: FindUserByEmailQuery): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } })
  }
}
