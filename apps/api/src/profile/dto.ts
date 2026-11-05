import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator'
import { PASSWORD_MAX_LENGTH } from '../auth/dto.js'
import { IsUserName } from '../users/user-name.js'

export class UpdateProfileDto {
  @IsUserName()
  name: string
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  // с запасом: пароли, заведённые до появления лимита при регистрации, могли быть длиннее
  @MaxLength(1024)
  currentPassword: string

  @IsString()
  @MinLength(8, { message: 'Пароль должен быть не короче 8 символов' })
  @MaxLength(PASSWORD_MAX_LENGTH, {
    message: `Пароль должен быть не длиннее ${PASSWORD_MAX_LENGTH} символов`,
  })
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
