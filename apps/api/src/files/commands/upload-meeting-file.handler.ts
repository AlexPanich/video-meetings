import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rmdir } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Logger, NotFoundException } from '@nestjs/common'
import { CommandHandler, type ICommandHandler, QueryBus } from '@nestjs/cqrs'
import type { FileInfo } from 'busboy'
import type { MeetingFile } from '../../generated/prisma/client.js'
import { GetMeetingQuery } from '../../meetings/queries/get-meeting.query.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { discardMeetingFile } from '../discard-file.js'
import { type PublicMeetingFile, toPublicMeetingFile } from '../meeting-file.js'
import { receiveSingleFile } from '../multipart.js'
import { sanitizeFileName, sanitizeMimeType } from '../sanitize.js'
import { prismaErrorCode } from '../stored-file.js'
import { getMaxUploadSize, getMeetingDir, getStoragePath } from '../storage.js'
import { UploadMeetingFileCommand } from './upload-meeting-file.command.js'

@CommandHandler(UploadMeetingFileCommand)
export class UploadMeetingFileHandler implements ICommandHandler<UploadMeetingFileCommand> {
  private readonly logger = new Logger(UploadMeetingFileHandler.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly queryBus: QueryBus,
  ) {}

  async execute({
    ownerId,
    meetingId,
    request,
  }: UploadMeetingFileCommand): Promise<PublicMeetingFile> {
    // владелец проверяется до чтения тела запроса (404 для чужой и несуществующей встречи)
    await this.queryBus.execute(new GetMeetingQuery(ownerId, meetingId))

    const file = await receiveSingleFile(request, {
      maxSize: getMaxUploadSize(),
      onFile: (stream, info) => this.store(meetingId, stream, info),
      rollback: (stored) => discardMeetingFile(this.prisma, stored, this.logger),
    })
    return toPublicMeetingFile(file)
  }

  private async store(
    meetingId: string,
    stream: NodeJS.ReadableStream,
    { filename, mimeType }: FileInfo,
  ): Promise<MeetingFile> {
    // на диске файл лежит под сгенерированным именем, исходное имя — только в БД
    const storageName = randomUUID()
    const record = await this.prisma.meetingFile
      .create({
        data: {
          meetingId,
          name: sanitizeFileName(filename),
          storageName,
          mimeType: sanitizeMimeType(mimeType),
          status: 'uploading',
        },
      })
      .catch((error: unknown) => {
        // встречу удалили после проверки владельца
        if (prismaErrorCode(error) === 'P2003') throw new NotFoundException('Встреча не найдена')
        throw error
      })

    try {
      await mkdir(getMeetingDir(meetingId), { recursive: true })
      const out = createWriteStream(getStoragePath(meetingId, storageName))
      await pipeline(stream, out)
      return await this.prisma.meetingFile.update({
        where: { id: record.id },
        data: { status: 'uploaded', size: out.bytesWritten },
      })
    } catch (error) {
      await discardMeetingFile(this.prisma, record, this.logger)
      if (prismaErrorCode(error) === 'P2025') {
        // встречу (а с ней и запись) удалили во время загрузки: убираем за собой и каталог,
        // который мог воскреснуть из-за mkdir; rmdir удаляет только пустой
        await rmdir(getMeetingDir(meetingId)).catch(() => undefined)
        throw new NotFoundException('Встреча не найдена')
      }
      throw error
    }
  }
}
