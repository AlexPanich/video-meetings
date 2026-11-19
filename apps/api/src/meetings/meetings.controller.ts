import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { type AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard.js'
import { DeleteMeetingCommand } from './commands/delete-meeting.command.js'
import { CreateMeetingCommand } from './commands/create-meeting.command.js'
import { CREATE_MEETING_BAD_REQUEST, CreateMeetingDto, PublicMeetingDto } from './dto.js'
import { GetMeetingQuery } from './queries/get-meeting.query.js'
import { ListMeetingsQuery } from './queries/list-meetings.query.js'

@ApiTags('meetings')
@ApiBearerAuth()
@Controller('meetings')
@UseGuards(JwtAuthGuard)
export class MeetingsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Создать встречу',
    description:
      'Название и имена участников обрезаются по краям пробелов; повторы участников без учёта регистра убираются, остаётся первое написание. Правила проверяются только при создании: встречи, созданные раньше, читаются без проверки.',
  })
  @ApiCreatedResponse({ description: 'Созданная встреча', type: PublicMeetingDto })
  @ApiBadRequestResponse({ description: CREATE_MEETING_BAD_REQUEST })
  @ApiUnauthorizedResponse({ description: 'Нет токена или токен недействителен' })
  create(
    @Req() req: AuthenticatedRequest,
    @Body() { title, date, participants }: CreateMeetingDto,
  ) {
    return this.commandBus.execute(
      new CreateMeetingCommand(req.userId, title, new Date(date), participants),
    )
  }

  @Get()
  @ApiOperation({ summary: 'Встречи текущего пользователя' })
  @ApiOkResponse({ type: [PublicMeetingDto] })
  list(@Req() req: AuthenticatedRequest) {
    return this.queryBus.execute(new ListMeetingsQuery(req.userId))
  }

  @Get(':id')
  @ApiOperation({ summary: 'Встреча по id' })
  @ApiOkResponse({ type: PublicMeetingDto })
  @ApiNotFoundResponse({ description: 'Встречи нет или она чужая' })
  get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.queryBus.execute(new GetMeetingQuery(req.userId, id))
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.commandBus.execute(new DeleteMeetingCommand(req.userId, id))
  }
}
