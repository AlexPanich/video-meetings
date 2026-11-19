import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator'
import { NAME_ALLOWED_PATTERN, NAME_ALLOWED_SCHEMA_PATTERN } from '../users/user-name.js'

// Ограничения встречи на входе POST /meetings (длины — после обрезки пробелов по краям).
// Чтение встреч их не проверяет: встречи, созданные до правил, по-прежнему отдаются.
export const MEETING_TITLE_MAX_LENGTH = 200
export const PARTICIPANT_NAME_MAX_LENGTH = 100
export const MEETING_PARTICIPANTS_MAX = 50

// Управляющие и bidi-символы запрещены, как в имени пользователя
const ALLOWED_TEXT = new RegExp(NAME_ALLOWED_PATTERN, 'u')
// Строка из одних невидимых символов (zero-width space и т. п. `trim` не убирает) — по сути пустая
const VISIBLE_TEXT = /[^\s\p{Z}\p{Cf}]/u

// Только расширенная календарная форма с временем и часовым поясом: её понимает `new Date`
// (недели, порядковые даты и базовый формат ISO 8601 дали бы Invalid Date и 500), а без пояса
// `new Date` понял бы время в поясе сервера. Существование дня проверяет `IsISO8601` (strict).
const DATE_TIME_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/
const DATE_MESSAGE =
  'Дата должна быть в формате ISO 8601 с часовым поясом, например 2030-01-15T10:00:00Z'

const trim = (value: unknown) => (typeof value === 'string' ? value.trim() : value)

// Схема Swagger задана явно: плагин работает только при `nest build`, в vitest схем полей нет.
// Метаданные плагина сливаются с явными; его `maxLength` у участников (`each`) @nestjs/swagger
// при построении массива переносит в `items` (`transformToArraySchemaProperty`), значение то же.
const TITLE_RULES = `пробелы по краям обрезаются, затем 1–${MEETING_TITLE_MAX_LENGTH} символов, без управляющих и bidi-символов, не из одних невидимых символов (zero-width space и т. п.)`
const PARTICIPANT_RULES = `не больше ${MEETING_PARTICIPANTS_MAX} имён (считаются до удаления повторов); имя обрезается по краям, затем 1–${PARTICIPANT_NAME_MAX_LENGTH} символов, без управляющих и bidi-символов, не из одних невидимых символов`
const DATE_RULES =
  'ISO 8601 в расширенной форме `YYYY-MM-DDTHH:MM`, секунды и доли секунды необязательны, часовой пояс обязателен (`Z` или `±HH:MM`), `T` и `Z` только заглавные, день должен существовать'

// Описание ответа 400 POST /meetings в Swagger
export const CREATE_MEETING_BAD_REQUEST = `Нарушено правило создания встречи. Название — строка: ${TITLE_RULES}. Участники — обязательный список строк: ${PARTICIPANT_RULES}. Дата — обязательна: ${DATE_RULES}. В \`message\` — список причин на русском`

export class CreateMeetingDto {
  @ApiProperty({
    description: `Название встречи: ${TITLE_RULES}`,
    minLength: 1,
    maxLength: MEETING_TITLE_MAX_LENGTH,
    pattern: NAME_ALLOWED_SCHEMA_PATTERN,
    example: 'Планёрка команды',
  })
  @Transform(({ value }: { value: unknown }) => trim(value))
  @IsString({ message: 'Название должно быть строкой' })
  @IsNotEmpty({ message: 'Название не может быть пустым' })
  @MaxLength(MEETING_TITLE_MAX_LENGTH, {
    message: `Название должно быть не длиннее ${MEETING_TITLE_MAX_LENGTH} символов`,
  })
  @Matches(ALLOWED_TEXT, { message: 'Название содержит недопустимые символы' })
  @Matches(VISIBLE_TEXT, { message: 'Название не может быть пустым' })
  title: string

  @ApiProperty({
    // без `format: 'date-time'`: RFC 3339 допускает строчные `t`/`z` и требует секунды
    description: `Дата и время встречи: ${DATE_RULES}; прошедшие и будущие даты принимаются`,
    pattern: DATE_TIME_WITH_ZONE.source,
    example: '2030-01-15T10:00:00Z',
  })
  @IsISO8601({ strict: true, strictSeparator: true }, { message: DATE_MESSAGE })
  @Matches(DATE_TIME_WITH_ZONE, { message: DATE_MESSAGE })
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
  @IsArray({ message: 'Участники должны быть списком' })
  @ArrayMaxSize(MEETING_PARTICIPANTS_MAX, {
    message: `Участников должно быть не больше ${MEETING_PARTICIPANTS_MAX}`,
  })
  @IsString({ each: true, message: 'Имя участника должно быть строкой' })
  @IsNotEmpty({ each: true, message: 'Имя участника не может быть пустым' })
  @MaxLength(PARTICIPANT_NAME_MAX_LENGTH, {
    each: true,
    message: `Имя участника должно быть не длиннее ${PARTICIPANT_NAME_MAX_LENGTH} символов`,
  })
  @Matches(ALLOWED_TEXT, { each: true, message: 'Имя участника содержит недопустимые символы' })
  @Matches(VISIBLE_TEXT, { each: true, message: 'Имя участника не может быть пустым' })
  participants: string[]
}
