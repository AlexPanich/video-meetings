import { Query } from '@nestjs/cqrs'
import type { PublicMeeting } from '../meeting.js'

export class GetMeetingQuery extends Query<PublicMeeting> {
  constructor(
    public readonly ownerId: string,
    public readonly id: string,
  ) {
    super()
  }
}
