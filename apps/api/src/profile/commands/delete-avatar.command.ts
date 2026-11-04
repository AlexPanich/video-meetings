import { Command } from '@nestjs/cqrs'

export class DeleteAvatarCommand extends Command<void> {
  constructor(public readonly userId: string) {
    super()
  }
}
