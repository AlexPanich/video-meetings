import { unlink } from 'node:fs/promises'
import type { Logger } from '@nestjs/common'
import type { MeetingFile } from '../generated/prisma/client.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import { getStoragePath } from './storage.js'

// откатывает неудавшуюся загрузку: удаляет файл с диска и помечает запись как failed;
// сбои очистки логируются, но не прерывают обработку исходной ошибки
export async function discardMeetingFile(
  prisma: PrismaService,
  file: Pick<MeetingFile, 'id' | 'meetingId' | 'storageName'>,
  logger: Logger,
): Promise<void> {
  await unlink(getStoragePath(file.meetingId, file.storageName)).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    logger.warn(`Не удалось удалить файл ${file.id}: ${String(error)}`)
  })
  await prisma.meetingFile
    .update({ where: { id: file.id }, data: { status: 'failed' } })
    .catch((error: unknown) => {
      logger.warn(`Не удалось пометить файл ${file.id} как failed: ${String(error)}`)
    })
}
