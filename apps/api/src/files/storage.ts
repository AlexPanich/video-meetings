import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// корень apps/api: от него считаются относительные пути, чтобы каталог не зависел от cwd
// (`src/files` и `dist/files` лежат на одной глубине)
const API_ROOT = fileURLToPath(new URL('../../', import.meta.url))

const DEFAULT_UPLOADS_DIR = 'uploads'
const DEFAULT_MAX_UPLOAD_BYTES = 500 * 1024 * 1024
// колонка `size` — Int (32 бита): больше файл в БД не поместится
const MAX_SUPPORTED_UPLOAD_SIZE = 2_147_483_647

// env читается при каждом вызове, чтобы значение можно было менять в тестах
export const getUploadsDir = () => resolve(API_ROOT, process.env.UPLOADS_DIR ?? DEFAULT_UPLOADS_DIR)

// максимальный размер одного файла в байтах (`MAX_UPLOAD_BYTES`, по умолчанию 500 МиБ)
export const getMaxUploadSize = () => {
  const value = Number(process.env.MAX_UPLOAD_BYTES)
  return Number.isInteger(value) && value > 0
    ? Math.min(value, MAX_SUPPORTED_UPLOAD_SIZE)
    : DEFAULT_MAX_UPLOAD_BYTES
}

export const getMeetingDir = (meetingId: string) => join(getUploadsDir(), meetingId)

export const getStoragePath = (meetingId: string, storageName: string) =>
  join(getMeetingDir(meetingId), storageName)
