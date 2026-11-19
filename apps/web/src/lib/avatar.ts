// Лимит и форматы — как у PUT /profile/avatar в API
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']
// для выбора файла: на части систем у валидной картинки пустой MIME, и фильтр только по типам её скрыл бы
export const AVATAR_ACCEPT = [...AVATAR_TYPES, '.jpg', '.jpeg', '.png', '.webp'].join(',')

const TYPE_ERROR = 'Допустимы только JPEG, PNG и WebP'

// Сигнатуры — как `detectAvatarMimeType` в `apps/api/src/profile/avatar.ts`; 12 байт хватает на все
const SIGNATURE_BYTES = 12
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0))
const startsWith = (head: Uint8Array, bytes: number[], offset = 0) =>
  head.length >= offset + bytes.length && bytes.every((byte, i) => head[offset + i] === byte)

export const hasAvatarSignature = (head: Uint8Array) =>
  startsWith(head, [0xff, 0xd8, 0xff]) ||
  startsWith(head, PNG_SIGNATURE) ||
  (startsWith(head, ascii('RIFF')) && startsWith(head, ascii('WEBP'), 8))

// Браузер и ОС иногда отдают для валидной картинки пустой или нестандартный тип (`image/jpg`,
// `image/pjpeg`): такой файл проверяется по сигнатуре, как это делает API. Явно другой тип
// (`application/pdf`) отклоняется сразу
const needsSniffing = (type: string) => type === '' || type.startsWith('image/')

const readHead = async (file: File): Promise<Uint8Array | null> => {
  try {
    return new Uint8Array(await file.slice(0, SIGNATURE_BYTES).arrayBuffer())
  } catch {
    return null
  }
}

// Причина, по которой файл нельзя отправить, или null. Окончательно формат проверяет API по сигнатуре
export const validateAvatarFile = async (file: File): Promise<string | null> => {
  if (!AVATAR_TYPES.includes(file.type)) {
    if (!needsSniffing(file.type)) return TYPE_ERROR
    const head = await readHead(file)
    // не удалось прочитать — решает API (вернёт 415 с причиной)
    if (head && !hasAvatarSignature(head)) return TYPE_ERROR
  }
  if (file.size > MAX_AVATAR_BYTES) return 'Файл больше 5 МБ'
  return null
}

export const avatarUrl = (version: number | null | undefined) =>
  `/api/profile/avatar${version ? `?v=${version}` : ''}`
