import { Command } from '@nestjs/cqrs'
import type { IncomingMessage } from 'node:http'
import type { PublicMeetingFile } from '../meeting-file.js'

export class UploadMeetingFileCommand extends Command<PublicMeetingFile> {
  constructor(
    public readonly ownerId: string,
    public readonly meetingId: string,
    // необработанный multipart-поток запроса: читается только после проверки владельца
    public readonly request: IncomingMessage,
  ) {
    super()
  }
}
