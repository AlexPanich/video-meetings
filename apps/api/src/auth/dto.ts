import { Transform } from 'class-transformer'
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator'
import { IsUserName } from '../users/user-name.js'

// Максимальная длина email (RFC 5321)
export const EMAIL_MAX_LENGTH = 254

// Максимальная длина нового пароля: при регистрации и смене одинаковая, иначе пароль нельзя сменить
export const PASSWORD_MAX_LENGTH = 128

// Верхняя граница пароля при входе (как у currentPassword): не даём гнать scrypt по мегабайтам
export const LOGIN_PASSWORD_MAX_LENGTH = 1024

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(LOGIN_PASSWORD_MAX_LENGTH)
  password: string
}

export class RegisterDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email: string

  @IsString()
  @MinLength(8)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string

  @IsUserName()
  name: string
}
