import { join, resolve } from 'node:path'

const DEFAULT_UPLOADS_DIR = './uploads'

// каталог читается при каждом вызове, чтобы значение env можно было менять в тестах
export const getUploadsDir = () => resolve(process.env.UPLOADS_DIR ?? DEFAULT_UPLOADS_DIR)

export const getMeetingDir = (meetingId: string) => join(getUploadsDir(), meetingId)

export const getStoragePath = (meetingId: string, storageName: string) =>
  join(getMeetingDir(meetingId), storageName)
