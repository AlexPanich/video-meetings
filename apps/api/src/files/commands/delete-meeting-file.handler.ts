import { unlink } from 'node:fs/promises'
import { Logger, NotFoundException } from '@nestjs/common'
import { CommandHandler, type ICommandHandler, QueryBus } from '@nestjs/cqrs'
import { GetMeetingQuery } from '../../meetings/queries/get-meeting.query.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { getStoragePath } from '../storage.js'
import { DeleteMeetingFileCommand } from './delete-meeting-file.command.js'

@CommandHandler(DeleteMeetingFileCommand)
export class DeleteMeetingFileHandler implements ICommandHandler<DeleteMeetingFileCommand> {
  private readonly logger = new Logger(DeleteMeetingFileHandler.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly queryBus: QueryBus,
  ) {}

  async execute({ ownerId, meetingId, fileId }: DeleteMeetingFileCommand): Promise<void> {
    // доступ к встрече проверяет модуль meetings (404 для чужой и несуществующей)
    await this.queryBus.execute(new GetMeetingQuery(ownerId, meetingId))
    // удалять можно только то, что пользователь видит в списке; загружающийся файл не трогаем
    const file = await this.prisma.meetingFile.findFirst({
      where: { id: fileId, meetingId, status: 'uploaded' },
    })
    if (!file) throw new NotFoundException('Файл не найден')

    // сначала запись: ссылки на несуществующий файл хуже, чем неудаляемый остаток на диске
    const { count } = await this.prisma.meetingFile.deleteMany({ where: { id: file.id } })
    if (count === 0) throw new NotFoundException('Файл не найден')
    await unlink(getStoragePath(meetingId, file.storageName)).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      this.logger.warn(`Не удалось удалить файл ${file.id} с диска: ${String(error)}`)
    })
  }
}
