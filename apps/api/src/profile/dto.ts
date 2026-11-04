import { Transform } from 'class-transformer'
import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator'

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

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  currentPassword: string

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string
}

// Схема ответа для Swagger: PublicUser — TS-тип, плагин Nest CLI строит схемы только из классов
export class PublicUserDto {
  id: string
  email: string
  name: string
  hasAvatar: boolean
  avatarVersion: number | null
}

// Схема ответа смены пароля для Swagger (как у входа)
export class AuthResultDto {
  accessToken: string
  user: PublicUserDto
}
