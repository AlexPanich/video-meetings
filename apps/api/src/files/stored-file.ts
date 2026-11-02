import { unlink } from 'node:fs/promises'
import type { Logger } from '@nestjs/common'
import { getStoragePath } from './storage.js'

// удаляет файл с диска; отсутствие файла — не ошибка, остальные сбои логируются и не пробрасываются
export async function removeStoredFile(
  file: { id: string; meetingId: string; storageName: string },
  logger: Logger,
): Promise<void> {
  await unlink(getStoragePath(file.meetingId, file.storageName)).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    logger.warn(`Не удалось удалить файл ${file.id} с диска: ${String(error)}`)
  })
}

// код ошибки Prisma (P2003 — нарушение внешнего ключа, P2025 — запись не найдена)
export const prismaErrorCode = (error: unknown) => (error as { code?: unknown }).code
