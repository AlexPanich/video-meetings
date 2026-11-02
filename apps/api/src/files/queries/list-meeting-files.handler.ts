import { type IQueryHandler, QueryBus, QueryHandler } from '@nestjs/cqrs'
import { GetMeetingQuery } from '../../meetings/queries/get-meeting.query.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { type PublicMeetingFile, toPublicMeetingFile } from '../meeting-file.js'
import { ListMeetingFilesQuery } from './list-meeting-files.query.js'

@QueryHandler(ListMeetingFilesQuery)
export class ListMeetingFilesHandler implements IQueryHandler<ListMeetingFilesQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryBus: QueryBus,
  ) {}

  async execute({ ownerId, meetingId }: ListMeetingFilesQuery): Promise<PublicMeetingFile[]> {
    // доступ к встрече проверяет модуль meetings (404 для чужой и несуществующей)
    await this.queryBus.execute(new GetMeetingQuery(ownerId, meetingId))
    // загружающиеся и неудавшиеся файлы пользователю не показываем
    const files = await this.prisma.meetingFile.findMany({
      where: { meetingId, status: 'uploaded' },
      orderBy: { createdAt: 'asc' },
    })
    return files.map(toPublicMeetingFile)
  }
}
