import { ConflictException, NotFoundException } from '@nestjs/common'
import { CommandHandler, type ICommandHandler, QueryBus } from '@nestjs/cqrs'
import type { MeetingSummary } from '../../generated/prisma/client.js'
import { prismaErrorCode } from '../../files/stored-file.js'
import { GetMeetingQuery } from '../../meetings/queries/get-meeting.query.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ACTIVE_SUMMARY_STATUSES, type PublicSummary, toPublicSummary } from '../summary.js'
import { SummaryRunner } from '../summary-runner.js'
import { StartSummaryCommand } from './start-summary.command.js'

const ALREADY_RUNNING = 'Саммари этой встречи уже готовится'

@CommandHandler(StartSummaryCommand)
export class StartSummaryHandler implements ICommandHandler<StartSummaryCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryBus: QueryBus,
    private readonly runner: SummaryRunner,
  ) {}

  async execute({ ownerId, meetingId }: StartSummaryCommand): Promise<PublicSummary> {
    // чужая и несуществующая встреча — 404
    await this.queryBus.execute(new GetMeetingQuery(ownerId, meetingId))
    const summary = await this.claim(meetingId)
    // задача живёт дольше запроса: ответ — 202 со статусом `pending`, итог — в БД
    void this.runner.run(meetingId)
    return toPublicSummary(summary)
  }

  // одна активная задача на встречу: запись одна (`meetingId` уникален), а перевод в `pending`
  // идёт условным UPDATE — из двух параллельных запусков проходит один, второй получает 409
  private async claim(meetingId: string): Promise<MeetingSummary> {
    const { count } = await this.prisma.meetingSummary.updateMany({
      where: { meetingId, status: { notIn: [...ACTIVE_SUMMARY_STATUSES] } },
      // `result` остаётся: прежнее саммари заменяется только после успеха
      data: { status: 'pending', error: null },
    })
    if (count > 0) {
      const claimed = await this.prisma.meetingSummary.findUnique({ where: { meetingId } })
      // встречу удалили сразу после захвата задачи
      if (!claimed) throw new NotFoundException('Встреча не найдена')
      return claimed
    }

    try {
      return await this.prisma.meetingSummary.create({ data: { meetingId } })
    } catch (error) {
      // запись уже есть, и задача активна (или её только что создал параллельный запрос)
      if (prismaErrorCode(error) === 'P2002') throw new ConflictException(ALREADY_RUNNING)
      // встречу удалили между проверкой и созданием
      if (prismaErrorCode(error) === 'P2003') throw new NotFoundException('Встреча не найдена')
      throw error
    }
  }
}
