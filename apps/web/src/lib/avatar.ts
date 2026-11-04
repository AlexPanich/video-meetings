// Лимит и форматы — как у PUT /profile/avatar в API
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// Причина, по которой файл нельзя отправить, или null. Окончательно формат проверяет API по сигнатуре
export const validateAvatarFile = (file: File): string | null => {
  if (!AVATAR_TYPES.includes(file.type)) return 'Допустимы только JPEG, PNG и WebP'
  if (file.size > MAX_AVATAR_BYTES) return 'Файл больше 5 МБ'
  return null
}

export const avatarUrl = (version: number | null | undefined) =>
  `/api/profile/avatar${version ? `?v=${version}` : ''}`
