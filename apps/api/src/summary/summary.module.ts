import { Module } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { AuthModule } from '../auth/auth.module.js'
import { TranscriptionModule } from '../transcription/transcription.module.js'
import { CancelMeetingSummaryHandler } from './commands/cancel-meeting-summary.handler.js'
import { StartSummaryHandler } from './commands/start-summary.handler.js'
import { GetSummaryHandler } from './queries/get-summary.handler.js'
import { StaleSummariesCleaner } from './stale-summaries.cleaner.js'
import { SummaryAgent } from './summary-agent.js'
import { SummaryController } from './summary.controller.js'
import { SummaryRunner } from './summary-runner.js'

@Module({
  imports: [CqrsModule, AuthModule, TranscriptionModule],
  controllers: [SummaryController],
  providers: [
    StartSummaryHandler,
    CancelMeetingSummaryHandler,
    GetSummaryHandler,
    SummaryAgent,
    SummaryRunner,
    StaleSummariesCleaner,
  ],
})
export class SummaryModule {}
