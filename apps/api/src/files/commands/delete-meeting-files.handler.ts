import { rm } from 'node:fs/promises'
import { Logger } from '@nestjs/common'
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs'
import { getMeetingDir, isSafePathSegment } from '../storage.js'
import { DeleteMeetingFilesCommand } from './delete-meeting-files.command.js'

@CommandHandler(DeleteMeetingFilesCommand)
export class DeleteMeetingFilesHandler implements ICommandHandler<DeleteMeetingFilesCommand> {
  private readonly logger = new Logger(DeleteMeetingFilesHandler.name)

  async execute({ meetingId }: DeleteMeetingFilesCommand): Promise<void> {
    // рекурсивное удаление: id обязан быть одним сегментом пути, иначе можно стереть весь каталог
    if (!isSafePathSegment(meetingId)) {
      throw new Error(`Недопустимый идентификатор встречи для удаления файлов: "${meetingId}"`)
    }
    // встреча уже удалена: сбой очистки диска не должен превращаться в ошибку для пользователя;
    // остаток уберёт сверка каталога с БД (OrphanFilesCleaner). Повторы — на случай файла,
    // который дописывается в момент удаления (ENOTEMPTY)
    await rm(getMeetingDir(meetingId), { recursive: true, force: true, maxRetries: 3 }).catch(
      (error: unknown) => {
        this.logger.warn(`Не удалось удалить каталог файлов встречи ${meetingId}: ${String(error)}`)
      },
    )
  }
}
