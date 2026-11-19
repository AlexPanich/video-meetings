import { applyDecorators } from '@nestjs/common'
import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator'
import { NAME_ALLOWED_PATTERN, NAME_ALLOWED_SCHEMA_PATTERN } from '../common/text-rules.js'

// Максимальная длина имени пользователя (после обрезки пробелов)
export const NAME_MAX_LENGTH = 100

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
