import { Query } from '@nestjs/cqrs'
import type { PublicMeetingFile } from '../meeting-file.js'

export class ListMeetingFilesQuery extends Query<PublicMeetingFile[]> {
  constructor(
    public readonly ownerId: string,
    public readonly meetingId: string,
  ) {
    super()
  }
}
