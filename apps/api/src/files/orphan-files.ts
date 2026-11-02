import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Logger } from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service.js'
import { getUploadsDir, UUID_PATTERN } from './storage.js'

const readNames = (dir: string) =>
  readdir(dir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })

/**
 * Сверяет каталог хранения с БД и удаляет осиротевшее: каталоги несуществующих встреч и файлы
 * без записи (остаются, если удаление с диска не удалось после удаления записи из БД).
 * Запись создаётся раньше файла, поэтому файл без записи — всегда сирота.
 * Трогаются только имена-uuid: посторонние файлы в каталоге хранения не затрагиваются.
 */
export async function removeOrphanFiles(prisma: PrismaService, logger: Logger): Promise<number> {
  const root = getUploadsDir()
  const dirs = (await readNames(root))
    .filter((entry) => entry.isDirectory() && UUID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
  if (dirs.length === 0) return 0

  const meetings = await prisma.meeting.findMany({
    where: { id: { in: dirs } },
    select: { id: true },
  })
  const existing = new Set(meetings.map((meeting) => meeting.id))
  let removed = 0

  for (const meetingId of dirs) {
    const dir = join(root, meetingId)
    if (!existing.has(meetingId)) {
      await rm(dir, { recursive: true, force: true })
      removed++
      continue
    }
    const names = (await readNames(dir))
      .filter((entry) => entry.isFile() && UUID_PATTERN.test(entry.name))
      .map((entry) => entry.name)
    if (names.length === 0) continue
    const rows = await prisma.meetingFile.findMany({
      where: { meetingId, storageName: { in: names } },
      select: { storageName: true },
    })
    const known = new Set(rows.map((row) => row.storageName))
    for (const name of names.filter((name) => !known.has(name))) {
      await rm(join(dir, name), { force: true })
      removed++
    }
  }
  if (removed > 0) logger.log(`Удалено осиротевших файлов и каталогов: ${removed}`)
  return removed
}
