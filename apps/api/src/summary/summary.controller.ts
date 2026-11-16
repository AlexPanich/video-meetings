import { Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { SkipThrottle } from '@nestjs/throttler'
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { type AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard.js'
import { AppThrottlerGuard } from '../rate-limit/throttler.guard.js'
import { StartSummaryCommand } from './commands/start-summary.command.js'
import { SummaryDto } from './dto.js'
import { GetSummaryQuery } from './queries/get-summary.query.js'

@ApiTags('meeting-summary')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Нет токена или он недействителен' })
@Controller('meetings/:meetingId/summary')
@UseGuards(JwtAuthGuard)
export class SummaryController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  // каждый запуск — агентный цикл на единственной Ollama: лимит по пользователю (троттлер
  // `account`, ключ — userId из токена, поэтому guard идёт после JwtAuthGuard), а не по IP
  @Post()
  @HttpCode(202)
  @UseGuards(AppThrottlerGuard)
  @SkipThrottle({ ip: true })
  @ApiTooManyRequestsResponse({ description: 'Превышен лимит запусков саммари' })
  @ApiOperation({
    summary: 'Запустить или пересоздать саммари встречи по текстовым файлам (фоновая задача)',
  })
  @ApiAcceptedResponse({ type: SummaryDto, description: 'Задача поставлена, статус `pending`' })
  @ApiNotFoundResponse({ description: 'Встреча не найдена' })
  @ApiConflictResponse({ description: 'Задача саммари этой встречи уже идёт' })
  start(@Req() req: AuthenticatedRequest, @Param('meetingId') meetingId: string) {
    return this.commandBus.execute(new StartSummaryCommand(req.userId, meetingId))
  }

  @Get()
  @ApiOperation({ summary: 'Статус и результат саммари встречи' })
  @ApiOkResponse({ type: SummaryDto })
  @ApiNotFoundResponse({ description: 'Встреча не найдена или саммари ещё не запускали' })
  get(@Req() req: AuthenticatedRequest, @Param('meetingId') meetingId: string) {
    return this.queryBus.execute(new GetSummaryQuery(req.userId, meetingId))
  }
}
