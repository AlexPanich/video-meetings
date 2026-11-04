import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotFoundException, UnauthorizedException } from '@nestjs/common'
import type { CommandBus } from '@nestjs/cqrs'
import { DeleteAvatarCommand } from './delete-avatar.command.js'
import { DeleteAvatarHandler } from './delete-avatar.handler.js'

describe('DeleteAvatarHandler', () => {
  let uploadsDir: string
  let commandBus: { execute: ReturnType<typeof vi.fn> }
  let handler: DeleteAvatarHandler
  const command = new DeleteAvatarCommand('u1')

  beforeEach(async () => {
    uploadsDir = await mkdtemp(join(tmpdir(), 'avatar-del-'))
    process.env.UPLOADS_DIR = uploadsDir
    await mkdir(join(uploadsDir, 'avatars'))
    commandBus = { execute: vi.fn() }
    handler = new DeleteAvatarHandler(commandBus as unknown as CommandBus)
  })

  afterEach(async () => {
    delete process.env.UPLOADS_DIR
    await rm(uploadsDir, { recursive: true, force: true })
  })

  it('очищает запись и удаляет файл', async () => {
    const file = join(uploadsDir, 'avatars', 'old')
    await writeFile(file, 'x')
    commandBus.execute.mockResolvedValue({ previousStorageName: 'old' })

    await handler.execute(command)

    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('файл уже отсутствует на диске — не ошибка', async () => {
    commandBus.execute.mockResolvedValue({ previousStorageName: 'gone' })

    await expect(handler.execute(command)).resolves.toBeUndefined()
  })

  it('404, если аватара не было', async () => {
    commandBus.execute.mockResolvedValue({ previousStorageName: null })

    await expect(handler.execute(command)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('401, если пользователя нет', async () => {
    commandBus.execute.mockResolvedValue(null)

    await expect(handler.execute(command)).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
