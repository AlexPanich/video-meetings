import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotFoundException, StreamableFile, UnauthorizedException } from '@nestjs/common'
import type { QueryBus } from '@nestjs/cqrs'
import { GetAvatarHandler } from './get-avatar.handler.js'
import { GetAvatarQuery } from './get-avatar.query.js'

describe('GetAvatarHandler', () => {
  let uploadsDir: string
  let queryBus: { execute: ReturnType<typeof vi.fn> }
  let handler: GetAvatarHandler

  beforeEach(async () => {
    uploadsDir = await mkdtemp(join(tmpdir(), 'avatar-unit-'))
    process.env.UPLOADS_DIR = uploadsDir
    await mkdir(join(uploadsDir, 'avatars'))
    queryBus = { execute: vi.fn() }
    handler = new GetAvatarHandler(queryBus as unknown as QueryBus)
  })

  afterEach(async () => {
    delete process.env.UPLOADS_DIR
    await rm(uploadsDir, { recursive: true, force: true })
  })

  it('отдаёт поток с MIME-типом из БД и размером', async () => {
    queryBus.execute.mockResolvedValue({ avatarStorageName: 'a1', avatarMimeType: 'image/png' })
    await writeFile(join(uploadsDir, 'avatars', 'a1'), 'bytes')

    const result = await handler.execute(new GetAvatarQuery('u1'))

    expect(result).toBeInstanceOf(StreamableFile)
    expect(result.getHeaders()).toMatchObject({ type: 'image/png', length: 5 })
    result.getStream().destroy()
  })

  it('404, если аватара нет в БД', async () => {
    queryBus.execute.mockResolvedValue({ avatarStorageName: null, avatarMimeType: null })

    await expect(handler.execute(new GetAvatarQuery('u1'))).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('404, если файла нет на диске', async () => {
    queryBus.execute.mockResolvedValue({ avatarStorageName: 'gone', avatarMimeType: 'image/png' })

    await expect(handler.execute(new GetAvatarQuery('u1'))).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('401, если пользователя нет', async () => {
    queryBus.execute.mockResolvedValue(null)

    await expect(handler.execute(new GetAvatarQuery('u1'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })
})
