import type { StreamableFile } from '@nestjs/common'
import { Query } from '@nestjs/cqrs'

export class DownloadMeetingFileQuery extends Query<StreamableFile> {
  constructor(
    public readonly ownerId: string,
    public readonly meetingId: string,
    public readonly fileId: string,
  ) {
    super()
  }
}
