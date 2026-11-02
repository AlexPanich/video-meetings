import { rm } from 'node:fs/promises'
import { Logger } from '@nestjs/common'
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs'
import { getMeetingDir } from '../storage.js'
import { DeleteMeetingFilesCommand } from './delete-meeting-files.command.js'

@CommandHandler(DeleteMeetingFilesCommand)
export class DeleteMeetingFilesHandler implements ICommandHandler<DeleteMeetingFilesCommand> {
  private readonly logger = new Logger(DeleteMeetingFilesHandler.name)

  async execute({ meetingId }: DeleteMeetingFilesCommand): Promise<void> {
    // встреча уже удалена: сбой очистки диска не должен превращаться в ошибку для пользователя
    await rm(getMeetingDir(meetingId), { recursive: true, force: true }).catch((error: unknown) => {
      this.logger.warn(`Не удалось удалить каталог файлов встречи ${meetingId}: ${String(error)}`)
    })
  }
}
