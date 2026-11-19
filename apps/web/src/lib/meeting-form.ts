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

// Как `PARTICIPANT_NAME_MAX_LENGTH` и `MEETING_PARTICIPANTS_MAX` в API
export const PARTICIPANT_NAME_MAX_LENGTH = 100
export const MEETING_PARTICIPANTS_MAX = 50

// Ключ повтора — тот же алгоритм, что `participantKey` в `apps/api/src/meetings/participants.ts`:
// иначе форма покажет два тега («Анна Петрова» и «Анна  Петрова»), а API молча сохранит один
export const participantKey = (name: string) =>
  name
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/[\s\p{Z}]+/gu, ' ')
    .trim()
    .toUpperCase()
    .toLowerCase()

// Добавленный участник с тем же ключом или undefined
export const findParticipant = (value: string, participants: readonly string[]) => {
  const key = participantKey(value)
  return participants.find((name) => participantKey(name) === key)
}

// Есть ли в имени что-то, кроме пробелов и невидимых символов
export const hasVisibleText = (value: string) => VISIBLE_TEXT.test(value.trim())

// Причина, по которой имя нельзя добавить к `participants`, или null. Порядок проверок — как в API
// (пусто, символы, длина), затем повтор и лимит списка
export const validateParticipant = (value: string, participants: readonly string[]) => {
  const name = value.trim()
  if (!hasVisibleText(name)) return 'Введите имя участника'
  if (FORBIDDEN_TEXT.test(name)) return 'Имя участника содержит недопустимые символы'
  if ([...name].length > PARTICIPANT_NAME_MAX_LENGTH) {
    return `Имя участника не длиннее ${PARTICIPANT_NAME_MAX_LENGTH} символов`
  }
  const existing = findParticipant(name, participants)
  if (existing !== undefined) return `Участник «${existing}» уже добавлен`
  if (participants.length >= MEETING_PARTICIPANTS_MAX) {
    return `Участников не больше ${MEETING_PARTICIPANTS_MAX}`
  }
  return null
}

// Добавляет имена по порядку; пустые куски пропускаются, а со `skipDuplicates` — и уже добавленные.
// На первом имени, которое нельзя добавить, останавливается: возвращает его индекс и причину,
// добавленные до него остаются в `list`
export const addParticipants = (
  names: readonly string[],
  participants: readonly string[],
  { skipDuplicates = false } = {},
): { list: string[]; failedAt: number; error: string | null } => {
  let list = [...participants]
  for (const [index, name] of names.entries()) {
    if (!hasVisibleText(name)) continue
    if (skipDuplicates && findParticipant(name, list) !== undefined) continue
    const error = validateParticipant(name, list)
    if (error) return { list, failedAt: index, error }
    list = [...list, name.trim()]
  }
  return { list, failedAt: -1, error: null }
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
// момент в ISO 8601 UTC. При переводе часов вперёд несуществующее время (02:30) `Date` сдвигает на
// час вперёд (03:30), при переводе назад из двух 01:30 берёт первое (летнее). Выбора пояса в форме
// нет, поэтому так и оставлено; поведение зафиксировано тестом
export const localDateTimeToIso = (date: string, time: string): string => {
  const [year, month, day] = date.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  const local = new Date(2000, 0, 1, hours, minutes)
  // год отдельно: конструктор `Date` читает годы 0–99 как 1900–1999
  local.setFullYear(year, month - 1, day)
  return local.toISOString()
}
