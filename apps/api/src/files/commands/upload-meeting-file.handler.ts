import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { pipeline } from 'node:stream/promises'
import { BadRequestException } from '@nestjs/common'
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs'
import busboy, { type FileInfo } from 'busboy'
import { assertMeetingOwner } from '../meeting-access.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { type PublicMeetingFile, toPublicMeetingFile } from '../meeting-file.js'
import { getMeetingDir, getStoragePath } from '../storage.js'
import { UploadMeetingFileCommand } from './upload-meeting-file.command.js'

@CommandHandler(UploadMeetingFileCommand)
export class UploadMeetingFileHandler implements ICommandHandler<UploadMeetingFileCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({
    ownerId,
    meetingId,
    request,
  }: UploadMeetingFileCommand): Promise<PublicMeetingFile> {
    // владелец проверяется до чтения тела запроса
    await assertMeetingOwner(this.prisma, ownerId, meetingId)
    return this.receive(request, meetingId)
  }

  private receive(request: IncomingMessage, meetingId: string): Promise<PublicMeetingFile> {
    return new Promise((resolve, reject) => {
      let parser: busboy.Busboy
      try {
        // один файл за запрос; defParamCharset нужен, чтобы кириллица в имени не ломалась
        parser = busboy({ headers: request.headers, defParamCharset: 'utf8', limits: { files: 1 } })
      } catch {
        reject(new BadRequestException('Ожидается multipart/form-data'))
        return
      }

      let stored: Promise<PublicMeetingFile> | undefined
      parser.on('file', (_field, stream, info) => {
        stored = this.store(meetingId, stream, info)
        stored.catch(() => undefined) // ошибка будет передана через 'close'
      })
      parser.on('error', reject)
      parser.on('close', () => {
        if (!stored) {
          reject(new BadRequestException('Файл не передан'))
          return
        }
        stored.then(resolve, reject)
      })
      request.pipe(parser)
    })
  }

  private async store(
    meetingId: string,
    stream: NodeJS.ReadableStream,
    { filename, mimeType }: FileInfo,
  ): Promise<PublicMeetingFile> {
    // на диске файл лежит под сгенерированным именем, исходное имя — только в БД
    const storageName = randomUUID()
    const path = getStoragePath(meetingId, storageName)
    const record = await this.prisma.meetingFile.create({
      data: { meetingId, name: filename ?? 'file', storageName, mimeType, status: 'uploading' },
    })

    try {
      await mkdir(getMeetingDir(meetingId), { recursive: true })
      const out = createWriteStream(path)
      await pipeline(stream, out)
      const uploaded = await this.prisma.meetingFile.update({
        where: { id: record.id },
        data: { status: 'uploaded', size: out.bytesWritten },
      })
      return toPublicMeetingFile(uploaded)
    } catch (error) {
      await unlink(path).catch(() => undefined)
      await this.prisma.meetingFile
        .update({ where: { id: record.id }, data: { status: 'failed' } })
        .catch(() => undefined)
      throw error
    }
  }
}
