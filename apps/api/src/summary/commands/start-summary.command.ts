import { Command } from '@nestjs/cqrs'
import type { PublicSummary } from '../summary.js'

/** Запуск саммари встречи или пересоздание готового/упавшего. */
export class StartSummaryCommand extends Command<PublicSummary> {
  constructor(
    public readonly ownerId: string,
    public readonly meetingId: string,
  ) {
    super()
  }
}
