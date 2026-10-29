import { NotFoundException } from '@nestjs/common'
import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { PrismaService } from '../../prisma/prisma.service.js'
import { type PublicMeeting, toPublicMeeting } from '../meeting.js'
import { GetMeetingQuery } from './get-meeting.query.js'

@QueryHandler(GetMeetingQuery)
export class GetMeetingHandler implements IQueryHandler<GetMeetingQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ ownerId, id }: GetMeetingQuery): Promise<PublicMeeting> {
    const meeting = await this.prisma.meeting.findFirst({ where: { id, ownerId } })
    if (!meeting) throw new NotFoundException('Встреча не найдена')
    return toPublicMeeting(meeting)
  }
}
