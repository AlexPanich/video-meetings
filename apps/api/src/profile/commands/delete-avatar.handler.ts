import { Logger, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { CommandBus, CommandHandler, type ICommandHandler } from '@nestjs/cqrs'
import { ClearUserAvatarCommand } from '../../users/commands/clear-user-avatar.command.js'
import { removeAvatarFile } from '../avatar.js'
import { DeleteAvatarCommand } from './delete-avatar.command.js'

@CommandHandler(DeleteAvatarCommand)
export class DeleteAvatarHandler implements ICommandHandler<DeleteAvatarCommand> {
  private readonly logger = new Logger(DeleteAvatarHandler.name)

  constructor(private readonly commandBus: CommandBus) {}

  async execute({ userId }: DeleteAvatarCommand): Promise<void> {
    // сначала очищается запись в БД, затем удаляется файл
    const result = await this.commandBus.execute(new ClearUserAvatarCommand(userId))
    if (!result) throw new UnauthorizedException()
    if (!result.previousStorageName) throw new NotFoundException('Аватар не найден')

    await removeAvatarFile(result.previousStorageName, this.logger)
  }
}
