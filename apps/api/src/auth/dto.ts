import { Transform } from 'class-transformer'
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator'
import { EMAIL_MAX_LENGTH, IsUserName } from '../users/user-name.js'

// Максимальная длина нового пароля: при регистрации и смене одинаковая, иначе пароль нельзя сменить
export const PASSWORD_MAX_LENGTH = 128

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email: string

  @IsString()
  @IsNotEmpty()
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
