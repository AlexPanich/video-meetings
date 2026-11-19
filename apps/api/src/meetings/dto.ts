import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { isISO8601, ValidateBy } from 'class-validator'
import {
  NAME_ALLOWED_PATTERN,
  NAME_ALLOWED_SCHEMA_PATTERN,
  VISIBLE_TEXT,
} from '../common/text-rules.js'

// Ограничения встречи на входе POST /meetings (длины — после обрезки пробелов по краям).
// Чтение встреч их не проверяет: встречи, созданные до правил, по-прежнему отдаются.
export const MEETING_TITLE_MAX_LENGTH = 200
export const PARTICIPANT_NAME_MAX_LENGTH = 100
export const MEETING_PARTICIPANTS_MAX = 50

// Управляющие и bidi-символы запрещены, как в имени пользователя
const ALLOWED_TEXT = new RegExp(NAME_ALLOWED_PATTERN, 'u')

// Только расширенная календарная форма с временем и часовым поясом: её понимает `new Date`
// (недели, порядковые даты и базовый формат ISO 8601 дали бы Invalid Date и 500), а без пояса
// `new Date` понял бы время в поясе сервера. Существование дня проверяет `isISO8601` (strict).
const DATE_TIME_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/
const DATE_MESSAGE =
  'Дата должна быть в формате ISO 8601 с часовым поясом, например 2030-01-15T10:00:00Z'

const trim = (value: unknown) => (typeof value === 'string' ? value.trim() : value)

// Причина, по которой текст не подходит, или null. Одна причина на поле: проверки идут по порядку
// и останавливаются на первой, иначе для `123` или отсутствующего поля клиент получил бы рядом
// с «должно быть строкой» ещё «не длиннее …» и «недопустимые символы». Длина — в кодовых точках,
// как `maxLength` в JSON Schema (эмодзи — один символ, селектор варианта U+FE0F — тоже).
const textProblem = (value: unknown, subject: string, maxLength: number): string | null => {
  if (typeof value !== 'string') return `${subject} должно быть строкой`
  if (!VISIBLE_TEXT.test(value)) return `${subject} не может быть пустым`
  if (!ALLOWED_TEXT.test(value)) return `${subject} содержит недопустимые символы`
  if ([...value].length > maxLength)
    return `${subject} должно быть не длиннее ${maxLength} символов`
  return null
}

const titleProblem = (value: unknown) => textProblem(value, 'Название', MEETING_TITLE_MAX_LENGTH)

// Для списка — одна причина: про сам список или про первое неподходящее имя
const participantsProblem = (value: unknown): string | null => {
  if (!Array.isArray(value)) return 'Участники должны быть списком'
  if (value.length > MEETING_PARTICIPANTS_MAX) {
    return `Участников должно быть не больше ${MEETING_PARTICIPANTS_MAX}`
  }
  for (const name of value) {
    const problem = textProblem(name, 'Имя участника', PARTICIPANT_NAME_MAX_LENGTH)
    if (problem) return problem
  }
  return null
}

const dateProblem = (value: unknown) =>
  typeof value === 'string' &&
  DATE_TIME_WITH_ZONE.test(value) &&
  isISO8601(value, { strict: true, strictSeparator: true })
    ? null
    : DATE_MESSAGE

// Правило поля: свой `name` у каждого, чтобы причины не перезаписывали друг друга в `constraints`
const Rule = (name: string, problem: (value: unknown) => string | null) =>
  ValidateBy({
    name,
    validator: {
      validate: (value: unknown) => problem(value) === null,
      defaultMessage: (args) => problem(args?.value) ?? '',
    },
  })

// Схема Swagger задана явно: плагин работает только при `nest build`, в vitest схем полей нет.
const TITLE_RULES = `пробелы по краям обрезаются, затем 1–${MEETING_TITLE_MAX_LENGTH} символов, без управляющих и bidi-символов, не из одних невидимых символов (пробелы, zero-width space, комбинирующие знаки, filler-символы)`
const PARTICIPANT_RULES = `не больше ${MEETING_PARTICIPANTS_MAX} имён (считаются до удаления повторов); имя обрезается по краям, затем 1–${PARTICIPANT_NAME_MAX_LENGTH} символов, без управляющих и bidi-символов, не из одних невидимых символов`
const DATE_RULES =
  'ISO 8601 в расширенной форме `YYYY-MM-DDTHH:MM`, секунды и доли секунды необязательны, часовой пояс обязателен (`Z` или `±HH:MM`), `T` и `Z` только заглавные, день должен существовать'

// Описание ответа 400 POST /meetings в Swagger
export const CREATE_MEETING_BAD_REQUEST = `Нарушено правило создания встречи. Название — обязательная строка: ${TITLE_RULES}. Участники — обязательный список строк: ${PARTICIPANT_RULES}. Дата — обязательна: ${DATE_RULES}. Длина считается в символах Unicode (кодовых точках). В \`message\` — список причин на русском, не больше одной на поле`

export class CreateMeetingDto {
  @ApiProperty({
    description: `Название встречи: ${TITLE_RULES}`,
    minLength: 1,
    maxLength: MEETING_TITLE_MAX_LENGTH,
    pattern: NAME_ALLOWED_SCHEMA_PATTERN,
    example: 'Планёрка команды',
  })
  @Transform(({ value }: { value: unknown }) => trim(value))
  @Rule('meetingTitle', titleProblem)
  title: string

  @ApiProperty({
    // без `format: 'date-time'`: RFC 3339 допускает строчные `t`/`z` и требует секунды
    description: `Дата и время встречи: ${DATE_RULES}; прошедшие и будущие даты принимаются`,
    pattern: DATE_TIME_WITH_ZONE.source,
    example: '2030-01-15T10:00:00Z',
  })
  @Rule('meetingDate', dateProblem)
  date: string

  @ApiProperty({
    description: `Участники: ${PARTICIPANT_RULES}. Повторы без учёта регистра убираются при сохранении, остаётся первое написание`,
    type: 'array',
    maxItems: MEETING_PARTICIPANTS_MAX,
    items: {
      type: 'string',
      minLength: 1,
      maxLength: PARTICIPANT_NAME_MAX_LENGTH,
      pattern: NAME_ALLOWED_SCHEMA_PATTERN,
    },
    example: ['Анна', 'Борис'],
  })
  @Transform(({ value }: { value: unknown }) => (Array.isArray(value) ? value.map(trim) : value))
  @Rule('meetingParticipants', participantsProblem)
  participants: string[]
}

// Схема ответа POST /meetings, GET /meetings и GET /meetings/:id для Swagger (модель — `PublicMeeting`)
export class PublicMeetingDto {
  @ApiProperty({ format: 'uuid' })
  id: string

  @ApiProperty({ example: 'Планёрка команды' })
  title: string

  @ApiProperty({ type: String, format: 'date-time', example: '2030-01-15T10:00:00.000Z' })
  date: string

  @ApiProperty({ type: [String], example: ['Анна', 'Борис'] })
  participants: string[]

  @ApiProperty({ format: 'uuid' })
  ownerId: string
}
