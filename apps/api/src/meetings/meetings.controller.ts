import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { type AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard.js'
import { CreateMeetingCommand } from './commands/create-meeting.command.js'
import { CreateMeetingDto } from './dto.js'
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
  create(
    @Req() req: AuthenticatedRequest,
    @Body() { title, date, participants }: CreateMeetingDto,
  ) {
    return this.commandBus.execute(
      new CreateMeetingCommand(req.userId, title, new Date(date), participants),
    )
  }

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.queryBus.execute(new ListMeetingsQuery(req.userId))
  }

  @Get(':id')
  get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.queryBus.execute(new GetMeetingQuery(req.userId, id))
  }
}
