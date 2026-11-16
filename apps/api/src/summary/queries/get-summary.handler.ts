import { NotFoundException } from '@nestjs/common'
import { type IQueryHandler, QueryBus, QueryHandler } from '@nestjs/cqrs'
import { GetMeetingQuery } from '../../meetings/queries/get-meeting.query.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { type PublicSummary, toPublicSummary } from '../summary.js'
import { GetSummaryQuery } from './get-summary.query.js'

@QueryHandler(GetSummaryQuery)
export class GetSummaryHandler implements IQueryHandler<GetSummaryQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryBus: QueryBus,
  ) {}

  async execute({ ownerId, meetingId }: GetSummaryQuery): Promise<PublicSummary> {
    await this.queryBus.execute(new GetMeetingQuery(ownerId, meetingId))
    const summary = await this.prisma.meetingSummary.findUnique({ where: { meetingId } })
    if (!summary) throw new NotFoundException('Саммари встречи ещё не запускали')
    return toPublicSummary(summary)
  }
}
