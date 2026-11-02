import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger'
import { type AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard.js'
import { UploadMeetingFileCommand } from './commands/upload-meeting-file.command.js'
import { ListMeetingFilesQuery } from './queries/list-meeting-files.query.js'

@ApiTags('meeting-files')
@ApiBearerAuth()
@Controller('meetings/:meetingId/files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Загрузить файл во встречу (один файл за запрос, поле `file`)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  upload(@Req() req: AuthenticatedRequest, @Param('meetingId') meetingId: string) {
    return this.commandBus.execute(new UploadMeetingFileCommand(req.userId, meetingId, req))
  }

  @Get()
  @ApiOperation({ summary: 'Список файлов встречи' })
  list(@Req() req: AuthenticatedRequest, @Param('meetingId') meetingId: string) {
    return this.queryBus.execute(new ListMeetingFilesQuery(req.userId, meetingId))
  }
}
