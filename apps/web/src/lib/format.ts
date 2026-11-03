import type { FileStatus } from './api'

const UNITS = ['Б', 'КБ', 'МБ', 'ГБ']

const sizeFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1, useGrouping: false })

// 1536 → «1,5 КБ»; единицы двоичные (1 КБ = 1024 Б), как в лимите загрузки
export function formatFileSize(bytes: number): string {
  let value = bytes
  let unit = 0
  // сравниваем уже округлённое значение: 1048575 Б — это «1 МБ», а не «1024 КБ»
  while (Math.round(value * 10) / 10 >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return `${sizeFormat.format(value)} ${UNITS[unit]}`
}

const STATUS_LABELS: Record<FileStatus, string> = {
  uploading: 'Загружается',
  uploaded: 'Загружен',
  failed: 'Ошибка',
}

export const fileStatusLabel = (status: FileStatus) => STATUS_LABELS[status]

export const formatParticipants = (count: number) => `${count} участн.`
