import { Logger, NotFoundException } from '@nestjs/common'
import { CommandHandler, type ICommandHandler, QueryBus } from '@nestjs/cqrs'
import { PrismaService } from '../../prisma/prisma.service.js'
import { findUploadedFile } from '../find-uploaded-file.js'
import { removeStoredFile } from '../stored-file.js'
import { DeleteMeetingFileCommand } from './delete-meeting-file.command.js'

@CommandHandler(DeleteMeetingFileCommand)
export class DeleteMeetingFileHandler implements ICommandHandler<DeleteMeetingFileCommand> {
  private readonly logger = new Logger(DeleteMeetingFileHandler.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly queryBus: QueryBus,
  ) {}

  async execute({ ownerId, meetingId, fileId }: DeleteMeetingFileCommand): Promise<void> {
    const file = await findUploadedFile(this.prisma, this.queryBus, ownerId, meetingId, fileId)

    // сначала запись: ссылки на несуществующий файл хуже, чем остаток на диске
    // (остаток потом уберёт сверка каталога с БД в OrphanFilesCleaner)
    const { count } = await this.prisma.meetingFile.deleteMany({ where: { id: file.id } })
    if (count === 0) throw new NotFoundException('Файл не найден')
    await removeStoredFile(file, this.logger)
  }
}
