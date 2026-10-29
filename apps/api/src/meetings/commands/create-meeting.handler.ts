import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs'
import { PrismaService } from '../../prisma/prisma.service.js'
import { type PublicMeeting, toPublicMeeting } from '../meeting.js'
import { CreateMeetingCommand } from './create-meeting.command.js'

@CommandHandler(CreateMeetingCommand)
export class CreateMeetingHandler implements ICommandHandler<CreateMeetingCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({
    ownerId,
    title,
    date,
    participants,
  }: CreateMeetingCommand): Promise<PublicMeeting> {
    const meeting = await this.prisma.meeting.create({
      data: { ownerId, title, date, participants },
    })
    return toPublicMeeting(meeting)
  }
}
