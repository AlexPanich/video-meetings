import { Query } from '@nestjs/cqrs'
import type { PublicSummary } from '../summary.js'

/** Статус и результат саммари встречи. */
export class GetSummaryQuery extends Query<PublicSummary> {
  constructor(
    public readonly ownerId: string,
    public readonly meetingId: string,
  ) {
    super()
  }
}
