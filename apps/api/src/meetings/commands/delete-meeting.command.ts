import { Command } from '@nestjs/cqrs'

export class DeleteMeetingCommand extends Command<void> {
  constructor(
    public readonly ownerId: string,
    public readonly id: string,
  ) {
    super()
  }
}
