import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Logger, NotFoundException } from '@nestjs/common'
import type { QueryBus } from '@nestjs/cqrs'
import { DeleteMeetingFileCommand } from './delete-meeting-file.command.js'
import { DeleteMeetingFileHandler } from './delete-meeting-file.handler.js'

describe('DeleteMeetingFileHandler', () => {
  let uploadsDir: string
  let prisma: {
    meetingFile: { findFirst: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> }
  }
  let queryBus: { execute: ReturnType<typeof vi.fn> }
  let handler: DeleteMeetingFileHandler

  const command = new DeleteMeetingFileCommand('u1', 'm1', 'f1')

  beforeEach(async () => {
    uploadsDir = await mkdtemp(join(tmpdir(), 'uploads-unit-'))
    process.env.UPLOADS_DIR = uploadsDir
    await mkdir(join(uploadsDir, 'm1'))
    prisma = {
      meetingFile: {
        findFirst: vi.fn().mockResolvedValue({ id: 'f1', meetingId: 'm1', storageName: 'stored' }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }
    queryBus = { execute: vi.fn().mockResolvedValue({ id: 'm1' }) }
    handler = new DeleteMeetingFileHandler(prisma as never, queryBus as unknown as QueryBus)
  })

  afterEach(async () => {
    delete process.env.UPLOADS_DIR
    await rm(uploadsDir, { recursive: true, force: true })
  })

  it('удаляет запись и файл с диска', async () => {
    await writeFile(join(uploadsDir, 'm1', 'stored'), 'x')

    await handler.execute(command)

    expect(prisma.meetingFile.deleteMany).toHaveBeenCalledWith({ where: { id: 'f1' } })
    expect(await readdir(join(uploadsDir, 'm1'))).toEqual([])
  })

  it('не падает, если файла уже нет на диске', async () => {
    await expect(handler.execute(command)).resolves.toBeUndefined()
    expect(prisma.meetingFile.deleteMany).toHaveBeenCalled()
  })

  it('404, если файла нет или он не в статусе uploaded; ничего не удаляется', async () => {
    prisma.meetingFile.findFirst.mockResolvedValue(null)

    await expect(handler.execute(command)).rejects.toBeInstanceOf(NotFoundException)

    expect(prisma.meetingFile.findFirst).toHaveBeenCalledWith({
      where: { id: 'f1', meetingId: 'm1', status: 'uploaded' },
    })
    expect(prisma.meetingFile.deleteMany).not.toHaveBeenCalled()
  })

  it('404, если запись удалил параллельный запрос; файл на диске не трогается', async () => {
    await writeFile(join(uploadsDir, 'm1', 'stored'), 'x')
    prisma.meetingFile.deleteMany.mockResolvedValue({ count: 0 })

    await expect(handler.execute(command)).rejects.toBeInstanceOf(NotFoundException)

    expect(await readdir(join(uploadsDir, 'm1'))).toEqual(['stored'])
  })

  it('нет доступа к встрече: ничего не ищется и не удаляется', async () => {
    queryBus.execute.mockRejectedValue(new NotFoundException())

    await expect(handler.execute(command)).rejects.toBeInstanceOf(NotFoundException)

    expect(prisma.meetingFile.findFirst).not.toHaveBeenCalled()
  })

  it('сбой удаления файла с диска только логируется: запись уже удалена, ответ успешный', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    // на месте файла каталог: unlink падает с EISDIR/EPERM, а не ENOENT
    await mkdir(join(uploadsDir, 'm1', 'stored'))

    await expect(handler.execute(command)).resolves.toBeUndefined()

    expect(prisma.meetingFile.deleteMany).toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Не удалось удалить файл f1'))
    warn.mockRestore()
  })
})
