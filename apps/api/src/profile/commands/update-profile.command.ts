import { Command } from '@nestjs/cqrs'
import type { PublicUser } from '../../users/user.js'

export class UpdateProfileCommand extends Command<PublicUser> {
  constructor(
    public readonly userId: string,
    public readonly name: string,
  ) {
    super()
  }
}
