const MAX_NAME_LENGTH = 255
const DEFAULT_NAME = 'file'
const DEFAULT_MIME_TYPE = 'application/octet-stream'
const MIME_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/

// имя приходит от клиента: убираем управляющие символы, режем по длине, пустое заменяем
export function sanitizeFileName(name: string | undefined): string {
  // Cc — управляющие (в т. ч. C1), Cf — форматирующие (bidi-переопределения вроде U+202E),
  // Zl/Zp — разделители строк и абзацев
  const cleaned = (name ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').trim()
  const limited = Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join('').trim()
  return limited || DEFAULT_NAME
}

// Content-Type части приходит от клиента: принимаем только корректный `type/subtype`
export function sanitizeMimeType(mimeType: string | undefined): string {
  const normalized = (mimeType ?? '').trim().toLowerCase()
  return normalized.length <= 127 && MIME_TYPE_PATTERN.test(normalized)
    ? normalized
    : DEFAULT_MIME_TYPE
}
