import { Transform } from 'class-transformer'
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator'

// Максимальная длина имени пользователя (после обрезки пробелов)
export const NAME_MAX_LENGTH = 100

export class UpdateProfileDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX_LENGTH)
  // управляющие символы (в том числе нулевой байт, который Postgres не принимает в text)
  @Matches(/^\P{Cc}*$/u, { message: 'name содержит недопустимые символы' })
  // невидимые имена (zero-width space и подобные) и имена без букв/цифр дали бы пустые инициалы
  @Matches(/[\p{L}\p{N}]/u, { message: 'name должно содержать букву или цифру' })
  name: string
}

// Схема ответа для Swagger: PublicUser — TS-тип, плагин Nest CLI строит схемы только из классов
export class PublicUserDto {
  id: string
  email: string
  name: string
}
