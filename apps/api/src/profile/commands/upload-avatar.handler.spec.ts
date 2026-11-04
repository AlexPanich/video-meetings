import type { IncomingMessage } from 'node:http'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import {
  PayloadTooLargeException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import type { CommandBus, QueryBus } from '@nestjs/cqrs'
import type { Mock } from 'vitest'
import { AVATAR_MAX_BYTES } from '../avatar.js'
import { UploadAvatarCommand } from './upload-avatar.command.js'
import { UploadAvatarHandler } from './upload-avatar.handler.js'

const BOUNDARY = 'unit-boundary'

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
])

const multipartBody = (content: Buffer) =>
  Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n` +
        'Content-Type: image/png\r\n\r\n',
    ),
    content,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ])

const fakeRequest = (body: Buffer) => {
  const request = new PassThrough() as unknown as PassThrough & IncomingMessage
  request.headers = {
    'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
    'content-length': String(body.length),
  }
  request.complete = true
  return request
}

describe('UploadAvatarHandler', () => {
  let uploadsDir: string
  let commandBus: { execute: ReturnType<typeof vi.fn> }
  let queryBus: { execute: Mock<(query: unknown) => Promise<unknown>> }
  let handler: UploadAvatarHandler

  const avatarFiles = () => readdir(join(uploadsDir, 'avatars')).catch(() => [] as string[])

  const run = (content: Buffer) => {
    const body = multipartBody(content)
    const request = fakeRequest(body)
    const result = handler.execute(new UploadAvatarCommand('u1', request))
    request.end(body)
    return result
  }

  beforeEach(async () => {
    uploadsDir = await mkdtemp(join(tmpdir(), 'avatar-unit-'))
    process.env.UPLOADS_DIR = uploadsDir
    commandBus = { execute: vi.fn() }
    queryBus = { execute: vi.fn() }
    handler = new UploadAvatarHandler(
      commandBus as unknown as CommandBus,
      queryBus as unknown as QueryBus,
    )
  })

  afterEach(async () => {
    await rm(uploadsDir, { recursive: true, force: true })
  })

  it('сохраняет файл, пишет в БД и возвращает PublicUser', async () => {
    commandBus.execute.mockImplementation(({ storageName }: { storageName: string }) => ({
      user: {
        id: 'u1',
        email: 'a@example.com',
        name: 'A',
        passwordHash: 'x',
        avatarStorageName: storageName,
        avatarUpdatedAt: new Date(1000),
      },
      previousStorageName: null,
    }))

    const result = await run(PNG)

    expect(result).toEqual({
      id: 'u1',
      email: 'a@example.com',
      name: 'A',
      hasAvatar: true,
      avatarVersion: 1000,
    })
    expect(commandBus.execute.mock.calls[0][0]).toMatchObject({
      userId: 'u1',
      mimeType: 'image/png',
    })
    expect(await avatarFiles()).toHaveLength(1)
  })

  it('после записи в БД удаляет прежний файл', async () => {
    const old = '00000000-0000-4000-8000-000000000001'
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(join(uploadsDir, 'avatars'))
    await writeFile(join(uploadsDir, 'avatars', old), 'old')
    commandBus.execute.mockResolvedValue({
      user: { id: 'u1', email: 'a', name: 'A' },
      previousStorageName: old,
    })

    await run(PNG)

    const files = await avatarFiles()
    expect(files).toHaveLength(1)
    expect(files).not.toContain(old)
  })

  it('415 для неподдерживаемого формата, файл не остаётся, БД не трогается', async () => {
    await expect(run(Buffer.from('<svg></svg>'))).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    )

    expect(await avatarFiles()).toEqual([])
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('413 для файла больше лимита', async () => {
    await expect(run(Buffer.concat([PNG, Buffer.alloc(AVATAR_MAX_BYTES)]))).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    )

    expect(await avatarFiles()).toEqual([])
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('при ошибке записи в БД новый файл удаляется', async () => {
    commandBus.execute.mockRejectedValue(new Error('db down'))

    await expect(run(PNG)).rejects.toThrow('db down')

    expect(await avatarFiles()).toEqual([])
  })

  describe('сбой команды, когда транзакция могла зафиксироваться', () => {
    const userWith = (avatarStorageName: string | null) => ({
      id: 'u1',
      email: 'a@example.com',
      name: 'A',
      passwordHash: 'x',
      avatarStorageName,
      avatarUpdatedAt: new Date(1000),
    })

    it('если в БД уже новый аватар, файл остаётся и запрос успешен', async () => {
      commandBus.execute.mockRejectedValue(new Error('connection lost on commit'))
      queryBus.execute.mockImplementation(async () => {
        const [name] = await avatarFiles()
        return userWith(name)
      })

      const result = await run(PNG)

      expect(result).toMatchObject({ id: 'u1', hasAvatar: true })
      expect(await avatarFiles()).toHaveLength(1)
    })

    it('если в БД другой аватар, новый файл удаляется и отдаётся исходная ошибка', async () => {
      commandBus.execute.mockRejectedValue(new Error('db down'))
      queryBus.execute.mockResolvedValue(userWith('00000000-0000-4000-8000-000000000009'))

      await expect(run(PNG)).rejects.toThrow('db down')

      expect(await avatarFiles()).toEqual([])
    })

    it('если БД недоступна и перечитать нельзя, файл остаётся для очистки осиротевших', async () => {
      commandBus.execute.mockRejectedValue(new Error('db down'))
      queryBus.execute.mockRejectedValue(new Error('db still down'))

      await expect(run(PNG)).rejects.toThrow('db down')

      expect(await avatarFiles()).toHaveLength(1)
    })
  })

  it('401 и удаление файла, если пользователя уже нет', async () => {
    commandBus.execute.mockResolvedValue(null)

    await expect(run(PNG)).rejects.toBeInstanceOf(UnauthorizedException)

    expect(await avatarFiles()).toEqual([])
  })
})
