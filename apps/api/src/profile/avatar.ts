import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { Logger } from '@nestjs/common'
import { getUploadsDir } from '../files/storage.js'

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024

// файл в `avatars` без записи в БД считается осиротевшим только после этого возраста: аватар пишется
// на диск раньше записи в БД, и свежий файл без записи может быть ещё идущей загрузкой
export const AVATAR_ORPHAN_MIN_AGE_MS = 60 * 60 * 1000

// столько первых байт достаточно для сигнатур JPEG, PNG и WebP (RIFF....WEBP)
export const AVATAR_SIGNATURE_BYTES = 12

export type AvatarMimeType = 'image/jpeg' | 'image/png' | 'image/webp'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const startsWith = (head: Buffer, bytes: number[], offset = 0) =>
  head.length >= offset + bytes.length && bytes.every((byte, i) => head[offset + i] === byte)

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0))

// MIME-тип определяется только по сигнатуре файла, заголовку клиента и расширению верить нельзя
export function detectAvatarMimeType(head: Buffer): AvatarMimeType | null {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(head, PNG_SIGNATURE)) return 'image/png'
  if (startsWith(head, ascii('RIFF')) && startsWith(head, ascii('WEBP'), 8)) return 'image/webp'
  return null
}

// аватары лежат отдельно от файлов встреч: каталоги встреч — uuid, `avatars` под sweep не попадает
export const getAvatarsDir = () => join(getUploadsDir(), 'avatars')

export const getAvatarPath = (storageName: string) => join(getAvatarsDir(), storageName)

// отсутствие файла — не ошибка; прочие сбои логируются с именем файла и не прерывают запрос
export const removeAvatarFile = async (storageName: string, logger: Logger): Promise<void> => {
  await unlink(getAvatarPath(storageName)).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    logger.warn(`Не удалось удалить файл аватара ${storageName}: ${String(error)}`)
  })
}
