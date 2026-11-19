import { applyDecorators } from '@nestjs/common'
import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator'

// Максимальная длина имени пользователя (после обрезки пробелов)
export const NAME_MAX_LENGTH = 100

// Запрещённые в имени символы: управляющие (в том числе нулевой байт, который Postgres не принимает
// в text) и bidi-управляющие (U+202E и др. меняют порядок отображения: `abc\u202Egnp.exe`).
// ZWJ не запрещаем: он нужен составным эмодзи и некоторым письменностям.
// Тот же набор — в `validateName` на вебе (`apps/web/src/lib/profile-name.ts`).
// Тот же набор — у названия встречи и имён участников (`apps/api/src/meetings/dto.ts`).
export const NAME_ALLOWED_PATTERN = '^[^\\p{Cc}\\p{Bidi_Control}]*$'

// Тот же набор для `pattern` в Swagger: в OpenAPI у регулярки нет флага `u`, и клиенты
// (Ajv по умолчанию, генераторы) прочли бы `\p{Cc}` как буквы `p`, `{`, `C`… Поэтому диапазоны
// перечислены явно; совпадение с NAME_ALLOWED_PATTERN проверяет `user-name.spec.ts`
export const NAME_ALLOWED_SCHEMA_PATTERN =
  '^[^\\u0000-\\u001F\\u007F-\\u009F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]*$'

// Общие правила имени для регистрации и смены имени: trim, не пустое, ≤ 100 символов,
// без управляющих и bidi-символов и с хотя бы одной буквой или цифрой
export const IsUserName = () =>
  applyDecorators(
    // Swagger-плагин не заглядывает внутрь applyDecorators, поэтому ограничения для схемы заданы здесь
    ApiProperty({ minLength: 1, maxLength: NAME_MAX_LENGTH, pattern: NAME_ALLOWED_SCHEMA_PATTERN }),
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim() : value,
    ),
    IsString(),
    IsNotEmpty(),
    MaxLength(NAME_MAX_LENGTH),
    Matches(new RegExp(NAME_ALLOWED_PATTERN, 'u'), {
      message: 'name содержит недопустимые символы',
    }),
    // невидимые имена (zero-width space и подобные) и имена без букв/цифр дали бы пустые инициалы
    Matches(/[\p{L}\p{N}]/u, { message: 'name должно содержать букву или цифру' }),
  )
