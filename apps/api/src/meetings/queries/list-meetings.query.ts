import { Query } from '@nestjs/cqrs'
import type { PublicMeeting } from '../meeting.js'

export class ListMeetingsQuery extends Query<PublicMeeting[]> {
  constructor(public readonly ownerId: string) {
    super()
  }
}
