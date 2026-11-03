// Максимальная длина имени (как `NAME_MAX_LENGTH` в API)
export const NAME_MAX_LENGTH = 100

// Те же правила, что на сервере (`PATCH /profile`): имя после обрезки пробелов не пустое, не длиннее
// лимита, без управляющих символов и с хотя бы одной буквой или цифрой. Возвращает текст ошибки.
export const validateName = (value: string): string | null => {
  const name = value.trim()
  if (!name) return 'Введите имя'
  if (name.length > NAME_MAX_LENGTH) return `Имя не длиннее ${NAME_MAX_LENGTH} символов`
  if (/\p{Cc}/u.test(name)) return 'Имя содержит недопустимые символы'
  if (!/[\p{L}\p{N}]/u.test(name)) return 'Имя должно содержать букву или цифру'
  return null
}
