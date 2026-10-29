import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import type { User } from '../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { FindUserByIdQuery } from './find-user-by-id.query.js'

@QueryHandler(FindUserByIdQuery)
export class FindUserByIdHandler implements IQueryHandler<FindUserByIdQuery> {
  constructor(private readonly prisma: PrismaService) {}

  execute({ id }: FindUserByIdQuery): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } })
  }
}
