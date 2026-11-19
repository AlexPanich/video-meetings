// Ключ сравнения имён участников. Одинаковыми считаются имена, которые выглядят одинаково:
// совместимые формы Unicode сводятся (NFKC: полноширинные буквы, лигатуры, составная и разложенная
// буква), невидимые символы (\p{Cf}: zero-width space, soft hyphen) убираются, пробелы
// схлопываются, регистр не учитывается (через верхний регистр, чтобы «ß» совпала с «SS»)
const participantKey = (name: string) =>
  name
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/[\s\p{Z}]+/gu, ' ')
    .trim()
    .toUpperCase()
    .toLowerCase()

// Убирает повторы участников, сохраняя первое написание (без пробелов по краям) и порядок первых
// вхождений. Лимит MEETING_PARTICIPANTS_MAX проверяется в DTO по списку как пришёл, до удаления
// повторов: он ограничивает размер запроса, а форма повторов не отправляет.
export const uniqueParticipants = (participants: readonly string[]): string[] => {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const name of participants) {
    const key = participantKey(name)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(name.trim())
  }
  return unique
}
