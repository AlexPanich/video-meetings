import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs'
import { SummaryRunner } from '../summary-runner.js'
import { CancelMeetingSummaryCommand } from './cancel-meeting-summary.command.js'

@CommandHandler(CancelMeetingSummaryCommand)
export class CancelMeetingSummaryHandler implements ICommandHandler<CancelMeetingSummaryCommand> {
  constructor(private readonly runner: SummaryRunner) {}

  execute({ meetingId }: CancelMeetingSummaryCommand): Promise<void> {
    return this.runner.cancel(meetingId)
  }
}
