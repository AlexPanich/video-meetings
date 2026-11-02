import { Module } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { AuthModule } from '../auth/auth.module.js'
import { UploadMeetingFileHandler } from './commands/upload-meeting-file.handler.js'
import { FilesController } from './files.controller.js'
import { ListMeetingFilesHandler } from './queries/list-meeting-files.handler.js'
import { StaleUploadsCleaner } from './stale-uploads.cleaner.js'

@Module({
  imports: [CqrsModule, AuthModule],
  controllers: [FilesController],
  providers: [UploadMeetingFileHandler, ListMeetingFilesHandler, StaleUploadsCleaner],
})
export class FilesModule {}
