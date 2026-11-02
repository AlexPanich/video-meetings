import { NotFoundException } from '@nestjs/common'
import type { CommandBus } from '@nestjs/cqrs'
import { DeleteMeetingFilesCommand } from '../../files/commands/delete-meeting-files.command.js'
import { DeleteMeetingCommand } from './delete-meeting.command.js'
import { DeleteMeetingHandler } from './delete-meeting.handler.js'

describe('DeleteMeetingHandler', () => {
  const setup = (count: number) => {
    const prisma = { meeting: { deleteMany: vi.fn().mockResolvedValue({ count }) } }
    const commandBus = { execute: vi.fn().mockResolvedValue(undefined) }
    const handler = new DeleteMeetingHandler(prisma as never, commandBus as unknown as CommandBus)
    return { prisma, commandBus, handler }
  }

  it('удаляет встречу владельца и просит модуль files убрать её файлы с диска', async () => {
    const { prisma, commandBus, handler } = setup(1)

    await handler.execute(new DeleteMeetingCommand('u1', 'm1'))

    expect(prisma.meeting.deleteMany).toHaveBeenCalledWith({ where: { id: 'm1', ownerId: 'u1' } })
    expect(commandBus.execute).toHaveBeenCalledWith(new DeleteMeetingFilesCommand('m1'))
  })

  it('404 для чужой или несуществующей встречи, файлы не трогаются', async () => {
    const { commandBus, handler } = setup(0)

    await expect(handler.execute(new DeleteMeetingCommand('u1', 'm1'))).rejects.toBeInstanceOf(
      NotFoundException,
    )

    expect(commandBus.execute).not.toHaveBeenCalled()
  })
})
