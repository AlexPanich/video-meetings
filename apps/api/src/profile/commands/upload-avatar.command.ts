import type { IncomingMessage } from 'node:http'
import { Command } from '@nestjs/cqrs'
import type { PublicUser } from '../../users/user.js'

export class UploadAvatarCommand extends Command<PublicUser> {
  constructor(
    public readonly userId: string,
    // необработанный multipart-поток запроса (как в UploadMeetingFileCommand)
    public readonly request: IncomingMessage,
  ) {
    super()
  }
}
