import { Command } from '@nestjs/cqrs'
import type { PublicMeeting } from '../meeting.js'

export class CreateMeetingCommand extends Command<PublicMeeting> {
  constructor(
    public readonly ownerId: string,
    public readonly title: string,
    public readonly date: Date,
    public readonly participants: string[],
  ) {
    super()
  }
}
