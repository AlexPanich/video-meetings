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
const NAME_ALLOWED_PATTERN = '^[^\\p{Cc}\\p{Bidi_Control}]*$'

// Общие правила имени для регистрации и смены имени: trim, не пустое, ≤ 100 символов,
// без управляющих и bidi-символов и с хотя бы одной буквой или цифрой
export const IsUserName = () =>
  applyDecorators(
    // Swagger-плагин не заглядывает внутрь applyDecorators, поэтому ограничения для схемы заданы здесь
    ApiProperty({ minLength: 1, maxLength: NAME_MAX_LENGTH, pattern: NAME_ALLOWED_PATTERN }),
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
