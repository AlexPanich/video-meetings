import type { Logger } from '@nestjs/common'
import type { MeetingFile } from '../generated/prisma/client.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import { prismaErrorCode, removeStoredFile } from './stored-file.js'

// откатывает неудавшуюся загрузку: удаляет файл с диска и помечает запись как failed;
// сбои очистки логируются, но не прерывают обработку исходной ошибки
export async function discardMeetingFile(
  prisma: PrismaService,
  file: Pick<MeetingFile, 'id' | 'meetingId' | 'storageName'>,
  logger: Logger,
): Promise<void> {
  await removeStoredFile(file, logger)
  await prisma.meetingFile
    .update({ where: { id: file.id }, data: { status: 'failed' } })
    .catch((error: unknown) => {
      // запись уже нет (встречу удалили во время загрузки) — помечать нечего
      if (prismaErrorCode(error) === 'P2025') return
      logger.warn(`Не удалось пометить файл ${file.id} как failed: ${String(error)}`)
    })
}
