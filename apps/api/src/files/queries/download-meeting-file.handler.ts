import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { NotFoundException, StreamableFile } from '@nestjs/common'
import { type IQueryHandler, QueryBus, QueryHandler } from '@nestjs/cqrs'
import { GetMeetingQuery } from '../../meetings/queries/get-meeting.query.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { attachmentDisposition } from '../content-disposition.js'
import { getStoragePath } from '../storage.js'
import { DownloadMeetingFileQuery } from './download-meeting-file.query.js'

@QueryHandler(DownloadMeetingFileQuery)
export class DownloadMeetingFileHandler implements IQueryHandler<DownloadMeetingFileQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryBus: QueryBus,
  ) {}

  async execute({ ownerId, meetingId, fileId }: DownloadMeetingFileQuery): Promise<StreamableFile> {
    // доступ к встрече проверяет модуль meetings (404 для чужой и несуществующей)
    await this.queryBus.execute(new GetMeetingQuery(ownerId, meetingId))
    const file = await this.prisma.meetingFile.findFirst({
      where: { id: fileId, meetingId, status: 'uploaded' },
    })
    if (!file) throw new NotFoundException('Файл не найден')

    // проверяем наличие файла до отправки заголовков: иначе обрыв потока даст не 404, а пустой ответ
    const path = getStoragePath(meetingId, file.storageName)
    const stats = await stat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') throw new NotFoundException('Файл не найден')
      throw error
    })

    return new StreamableFile(createReadStream(path), {
      type: file.mimeType,
      disposition: attachmentDisposition(file.name),
      length: stats.size,
    })
  }
}
