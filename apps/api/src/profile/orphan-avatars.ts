import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Logger } from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service.js'
import { UUID_PATTERN } from '../files/storage.js'
import { AVATAR_ORPHAN_MIN_AGE_MS, getAvatarsDir } from './avatar.js'

/**
 * Удаляет из `avatars` файлы, на которые не ссылается ни один пользователь: остаются, если процесс
 * упал между записью файла и обновлением БД или удаление старого файла не удалось. В отличие от
 * файлов встреч, файл здесь пишется раньше записи, поэтому удаляются только файлы старше
 * `AVATAR_ORPHAN_MIN_AGE_MS`. Трогаются только имена-uuid, посторонние файлы не затрагиваются.
 */
export async function removeOrphanAvatars(
  prisma: PrismaService,
  logger: Logger,
  now = Date.now(),
): Promise<number> {
  const dir = getAvatarsDir()
  const entries = await readdir(dir, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    },
  )
  const names = entries
    .filter((entry) => entry.isFile() && UUID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
  if (names.length === 0) return 0

  const rows = await prisma.user.findMany({
    where: { avatarStorageName: { in: names } },
    select: { avatarStorageName: true },
  })
  const known = new Set(rows.map((row) => row.avatarStorageName))

  let removed = 0
  for (const name of names.filter((name) => !known.has(name))) {
    const info = await stat(join(dir, name)).catch(() => null)
    if (!info || now - info.mtimeMs < AVATAR_ORPHAN_MIN_AGE_MS) continue
    await rm(join(dir, name), { force: true })
    removed++
  }
  if (removed > 0) logger.log(`Удалено осиротевших файлов аватаров: ${removed}`)
  return removed
}
