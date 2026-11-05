import { applyDecorators } from '@nestjs/common'
import { Transform } from 'class-transformer'
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator'

// Максимальная длина имени пользователя (после обрезки пробелов)
export const NAME_MAX_LENGTH = 100

// Максимальная длина email (RFC 5321)
export const EMAIL_MAX_LENGTH = 254

// Общие правила имени для регистрации и смены имени: trim, не пустое, ≤ 100 символов,
// без управляющих символов и с хотя бы одной буквой или цифрой
export const IsUserName = () =>
  applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim() : value,
    ),
    IsString(),
    IsNotEmpty(),
    MaxLength(NAME_MAX_LENGTH),
    // управляющие символы (в том числе нулевой байт, который Postgres не принимает в text)
    Matches(/^\P{Cc}*$/u, { message: 'name содержит недопустимые символы' }),
    // невидимые имена (zero-width space и подобные) и имена без букв/цифр дали бы пустые инициалы
    Matches(/[\p{L}\p{N}]/u, { message: 'name должно содержать букву или цифру' }),
  )
