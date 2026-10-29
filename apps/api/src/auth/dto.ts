import { Transform } from 'class-transformer'
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator'

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail()
  email: string

  @IsString()
  @IsNotEmpty()
  password: string
}

export class RegisterDto {
  @Transform(normalizeEmail)
  @IsEmail()
  email: string

  @IsString()
  @MinLength(8)
  password: string

  @IsString()
  @IsNotEmpty()
  name: string
}
