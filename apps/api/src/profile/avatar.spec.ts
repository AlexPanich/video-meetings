import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Logger } from '@nestjs/common'
import {
  AVATAR_SIGNATURE_BYTES,
  detectAvatarMimeType,
  getAvatarPath,
  removeAvatarFile,
} from './avatar.js'

describe('detectAvatarMimeType', () => {
  it('распознаёт JPEG', () => {
    expect(detectAvatarMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg')
  })

  it('распознаёт PNG', () => {
    const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    expect(detectAvatarMimeType(head)).toBe('image/png')
  })

  it('распознаёт WebP', () => {
    const head = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x40, 0, 0, 0]),
      Buffer.from('WEBP'),
    ])
    expect(detectAvatarMimeType(head)).toBe('image/webp')
  })

  it('не принимает RIFF без WEBP (например, WAV)', () => {
    const head = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x40, 0, 0, 0]),
      Buffer.from('WAVE'),
    ])
    expect(detectAvatarMimeType(head)).toBeNull()
  })

  it.each([
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['GIF', Buffer.from('GIF89a......')],
    ['текст', Buffer.from('это вовсе не картинка')],
    ['пусто', Buffer.alloc(0)],
    ['обрезанная сигнатура PNG', Buffer.from([0x89, 0x50, 0x4e])],
  ])('отклоняет %s', (_, head) => {
    expect(detectAvatarMimeType(head)).toBeNull()
  })

  it('для сигнатуры хватает AVATAR_SIGNATURE_BYTES байт', () => {
    expect(AVATAR_SIGNATURE_BYTES).toBe(12)
  })
})

describe('removeAvatarFile', () => {
  let uploadsDir: string
  const logger = new Logger('test')

  beforeEach(async () => {
    uploadsDir = await mkdtemp(join(tmpdir(), 'avatar-file-unit-'))
    process.env.UPLOADS_DIR = uploadsDir
    await mkdir(join(uploadsDir, 'avatars'))
  })

  afterEach(async () => {
    delete process.env.UPLOADS_DIR
    await rm(uploadsDir, { recursive: true, force: true })
  })

  it('удаляет файл', async () => {
    await writeFile(getAvatarPath('a'), 'x')
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)

    await removeAvatarFile('a', logger)

    await expect(rm(getAvatarPath('a'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('отсутствие файла не ошибка и не пишется в лог', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)

    await removeAvatarFile('missing', logger)

    expect(warn).not.toHaveBeenCalled()
  })

  it('прочие сбои логируются с именем файла и не бросаются', async () => {
    // вместо файла каталог: unlink завершится EISDIR/EPERM, а не ENOENT
    await mkdir(getAvatarPath('dir'))
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)

    await expect(removeAvatarFile('dir', logger)).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dir'))
  })
})
