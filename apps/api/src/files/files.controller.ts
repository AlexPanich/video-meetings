import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { type AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard.js'
import { UploadMeetingFileCommand } from './commands/upload-meeting-file.command.js'
import { DeleteMeetingFileCommand } from './commands/delete-meeting-file.command.js'
import { DownloadMeetingFileQuery } from './queries/download-meeting-file.query.js'
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

  @Get(':fileId/download')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({ summary: 'Скачать файл под исходным именем (потоком)' })
  @ApiOkResponse({
    description: 'Содержимое файла; Content-Disposition: attachment с исходным именем',
    content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiNotFoundResponse({ description: 'Встреча или файл не найдены' })
  download(
    @Req() req: AuthenticatedRequest,
    @Param('meetingId') meetingId: string,
    @Param('fileId') fileId: string,
  ) {
    return this.queryBus.execute(new DownloadMeetingFileQuery(req.userId, meetingId, fileId))
  }

  @Delete(':fileId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить файл: запись в БД и файл на диске' })
  @ApiNoContentResponse({ description: 'Файл удалён' })
  @ApiNotFoundResponse({ description: 'Встреча или файл не найдены' })
  remove(
    @Req() req: AuthenticatedRequest,
    @Param('meetingId') meetingId: string,
    @Param('fileId') fileId: string,
  ) {
    return this.commandBus.execute(new DeleteMeetingFileCommand(req.userId, meetingId, fileId))
  }
}
