import { Transform } from 'class-transformer'
import { IsNotEmpty, IsString } from 'class-validator'

export class UpdateProfileDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  name: string
}
