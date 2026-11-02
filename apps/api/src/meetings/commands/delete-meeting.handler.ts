import { NotFoundException } from '@nestjs/common'
import { CommandBus, CommandHandler, type ICommandHandler } from '@nestjs/cqrs'
import { DeleteMeetingFilesCommand } from '../../files/commands/delete-meeting-files.command.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { DeleteMeetingCommand } from './delete-meeting.command.js'

@CommandHandler(DeleteMeetingCommand)
export class DeleteMeetingHandler implements ICommandHandler<DeleteMeetingCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commandBus: CommandBus,
  ) {}

  async execute({ ownerId, id }: DeleteMeetingCommand): Promise<void> {
    // записи файлов удаляются каскадом вместе со встречей
    const { count } = await this.prisma.meeting.deleteMany({ where: { id, ownerId } })
    if (count === 0) throw new NotFoundException('Встреча не найдена')
    // физические файлы убирает модуль files
    await this.commandBus.execute(new DeleteMeetingFilesCommand(id))
  }
}
