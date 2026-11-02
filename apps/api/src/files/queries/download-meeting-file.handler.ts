import { open } from 'node:fs/promises'
import { NotFoundException, StreamableFile } from '@nestjs/common'
import { type IQueryHandler, QueryBus, QueryHandler } from '@nestjs/cqrs'
import { PrismaService } from '../../prisma/prisma.service.js'
import { attachmentDisposition } from '../content-disposition.js'
import { findUploadedFile } from '../find-uploaded-file.js'
import { getStoragePath } from '../storage.js'
import { DownloadMeetingFileQuery } from './download-meeting-file.query.js'

@QueryHandler(DownloadMeetingFileQuery)
export class DownloadMeetingFileHandler implements IQueryHandler<DownloadMeetingFileQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryBus: QueryBus,
  ) {}

  async execute({ ownerId, meetingId, fileId }: DownloadMeetingFileQuery): Promise<StreamableFile> {
    const file = await findUploadedFile(this.prisma, this.queryBus, ownerId, meetingId, fileId)

    // файл открывается сразу и один раз: между проверкой и чтением его не успеют удалить,
    // а отсутствие файла даёт 404 до отправки заголовков
    const handle = await open(getStoragePath(meetingId, file.storageName), 'r').catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') throw new NotFoundException('Файл не найден')
        throw error
      },
    )
    try {
      const { size } = await handle.stat()
      // поток закрывает дескриптор сам (autoClose)
      return new StreamableFile(handle.createReadStream(), {
        type: file.mimeType,
        disposition: attachmentDisposition(file.name),
        length: size,
      })
    } catch (error) {
      await handle.close().catch(() => undefined)
      throw error
    }
  }
}
