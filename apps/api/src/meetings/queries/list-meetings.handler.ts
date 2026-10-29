import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { PrismaService } from '../../prisma/prisma.service.js'
import { type PublicMeeting, toPublicMeeting } from '../meeting.js'
import { ListMeetingsQuery } from './list-meetings.query.js'

@QueryHandler(ListMeetingsQuery)
export class ListMeetingsHandler implements IQueryHandler<ListMeetingsQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ ownerId }: ListMeetingsQuery): Promise<PublicMeeting[]> {
    const meetings = await this.prisma.meeting.findMany({
      where: { ownerId },
      orderBy: { date: 'asc' },
    })
    return meetings.map(toPublicMeeting)
  }
}
