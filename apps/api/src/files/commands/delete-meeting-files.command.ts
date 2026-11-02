import { Command } from '@nestjs/cqrs'

// внутренняя команда: убирает с диска все файлы встречи (записи в БД удаляются вместе со встречей)
export class DeleteMeetingFilesCommand extends Command<void> {
  constructor(public readonly meetingId: string) {
    super()
  }
}
