import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { PrismaService } from '../../prisma/prisma.service.js'
import { GetUserTokenVersionQuery } from './get-user-token-version.query.js'

@QueryHandler(GetUserTokenVersionQuery)
export class GetUserTokenVersionHandler implements IQueryHandler<GetUserTokenVersionQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ id }: GetUserTokenVersionQuery): Promise<number | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { tokenVersion: true },
    })
    return user?.tokenVersion ?? null
  }
}
