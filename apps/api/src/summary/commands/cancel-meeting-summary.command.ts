import { Command } from '@nestjs/cqrs'

// внутренняя команда: встречу удалили — идущая генерация её саммари отменяется (запись саммари
// удаляется каскадом вместе со встречей)
export class CancelMeetingSummaryCommand extends Command<void> {
  constructor(public readonly meetingId: string) {
    super()
  }
}
