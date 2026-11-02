import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { PrismaService } from '../../prisma/prisma.service.js'
import { assertMeetingOwner } from '../meeting-access.js'
import { type PublicMeetingFile, toPublicMeetingFile } from '../meeting-file.js'
import { ListMeetingFilesQuery } from './list-meeting-files.query.js'

@QueryHandler(ListMeetingFilesQuery)
export class ListMeetingFilesHandler implements IQueryHandler<ListMeetingFilesQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ ownerId, meetingId }: ListMeetingFilesQuery): Promise<PublicMeetingFile[]> {
    await assertMeetingOwner(this.prisma, ownerId, meetingId)
    const files = await this.prisma.meetingFile.findMany({
      where: { meetingId },
      orderBy: { createdAt: 'asc' },
    })
    return files.map(toPublicMeetingFile)
  }
}
