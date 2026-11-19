// Правила формы создания встречи: те же, что у `POST /meetings` в API (`apps/api/src/meetings/dto.ts`)

// Максимальная длина названия после обрезки пробелов (как `MEETING_TITLE_MAX_LENGTH` в API)
export const MEETING_TITLE_MAX_LENGTH = 200

// Хотя бы один видимый символ — как `VISIBLE_TEXT` в `apps/api/src/common/text-rules.ts`: пробелы,
// невидимые символы формата, одиночные комбинирующие знаки и filler-символы пустыми и выглядят
const VISIBLE_TEXT = /[^\s\p{Z}\p{Cf}\p{M}ᅟᅠ⠀ㅤﾠ]/u
// Управляющие и bidi-символы запрещены (как `NAME_ALLOWED_PATTERN` в API и `validateName`)
const FORBIDDEN_TEXT = /[\p{Cc}\p{Bidi_Control}]/u

// Причина, по которой название не подходит, или null. Порядок проверок — как в API
export const validateMeetingTitle = (value: string): string | null => {
  const title = value.trim()
  if (!VISIBLE_TEXT.test(title)) return 'Введите название'
  if (FORBIDDEN_TEXT.test(title)) return 'Название содержит недопустимые символы'
  // в кодовых точках, а не в единицах UTF-16: так считает API (эмодзи — один символ)
  if ([...title].length > MEETING_TITLE_MAX_LENGTH) {
    return `Название не длиннее ${MEETING_TITLE_MAX_LENGTH} символов`
  }
  return null
}

const pad = (n: number) => String(n).padStart(2, '0')

// Начало встречи по умолчанию — ближайший следующий целый час по времени браузера
// (ровно в 14:00 — 15:00; после 23:00 — полночь следующего дня). Дата `YYYY-MM-DD`, время `HH:MM`
export const defaultMeetingStart = (now: Date = new Date()): { date: string; time: string } => {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1)
  return {
    date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
    time: `${pad(start.getHours())}:00`,
  }
}

// Дата `YYYY-MM-DD` и время `HH:MM` (секунды, если есть, отбрасываются) в часовом поясе браузера →
// момент в ISO 8601 UTC
export const localDateTimeToIso = (date: string, time: string): string => {
  const [year, month, day] = date.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  const local = new Date(2000, 0, 1, hours, minutes)
  // год отдельно: конструктор `Date` читает годы 0–99 как 1900–1999
  local.setFullYear(year, month - 1, day)
  return local.toISOString()
}
