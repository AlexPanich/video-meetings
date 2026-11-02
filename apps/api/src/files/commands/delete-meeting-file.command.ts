import { Command } from '@nestjs/cqrs'

export class DeleteMeetingFileCommand extends Command<void> {
  constructor(
    public readonly ownerId: string,
    public readonly meetingId: string,
    public readonly fileId: string,
  ) {
    super()
  }
}
