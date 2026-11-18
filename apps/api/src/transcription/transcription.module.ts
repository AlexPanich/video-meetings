import { Module } from '@nestjs/common'
import { MeetingTranscriber } from './meeting-transcriber.js'
import { WhisperClient } from './whisper-client.js'

// транскрибация аудио и видео встречи для саммари; HTTP-эндпоинтов нет
@Module({
  providers: [WhisperClient, MeetingTranscriber],
  exports: [MeetingTranscriber],
})
export class TranscriptionModule {}
