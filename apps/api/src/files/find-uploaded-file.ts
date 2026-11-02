import { NotFoundException } from '@nestjs/common'
import type { QueryBus } from '@nestjs/cqrs'
import type { MeetingFile } from '../generated/prisma/client.js'
import { GetMeetingQuery } from '../meetings/queries/get-meeting.query.js'
import type { PrismaService } from '../prisma/prisma.service.js'

/**
 * Файл, который пользователь видит в списке: проверяет доступ к встрече (модуль meetings,
 * 404 для чужой и несуществующей) и берёт только файл этой встречи в статусе `uploaded`.
 */
export async function findUploadedFile(
  prisma: PrismaService,
  queryBus: QueryBus,
  ownerId: string,
  meetingId: string,
  fileId: string,
): Promise<MeetingFile> {
  await queryBus.execute(new GetMeetingQuery(ownerId, meetingId))
  const file = await prisma.meetingFile.findFirst({
    where: { id: fileId, meetingId, status: 'uploaded' },
  })
  if (!file) throw new NotFoundException('Файл не найден')
  return file
}
