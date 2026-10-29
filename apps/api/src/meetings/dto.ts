import { IsArray, IsDateString, IsNotEmpty, IsString } from 'class-validator'

export class CreateMeetingDto {
  @IsString()
  @IsNotEmpty()
  title: string

  @IsDateString()
  date: string

  @IsArray()
  @IsString({ each: true })
  participants: string[]
}
