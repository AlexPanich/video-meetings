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
import { NAME_ALLOWED_PATTERN } from '../users/user-name.js'

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
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i
const DATE_MESSAGE =
  'Дата должна быть в формате ISO 8601 с часовым поясом, например 2030-01-15T10:00:00Z'

const trim = (value: unknown) => (typeof value === 'string' ? value.trim() : value)

export class CreateMeetingDto {
  @Transform(({ value }: { value: unknown }) => trim(value))
  @IsString({ message: 'Название должно быть строкой' })
  @IsNotEmpty({ message: 'Название не может быть пустым' })
  @MaxLength(MEETING_TITLE_MAX_LENGTH, {
    message: `Название должно быть не длиннее ${MEETING_TITLE_MAX_LENGTH} символов`,
  })
  @Matches(ALLOWED_TEXT, { message: 'Название содержит недопустимые символы' })
  @Matches(VISIBLE_TEXT, { message: 'Название не может быть пустым' })
  title: string

  @IsISO8601({ strict: true, strictSeparator: true }, { message: DATE_MESSAGE })
  @Matches(DATE_TIME_WITH_ZONE, { message: DATE_MESSAGE })
  date: string

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
