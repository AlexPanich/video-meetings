import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Logger } from '@nestjs/common'
import { DeleteMeetingFilesCommand } from './delete-meeting-files.command.js'
import { DeleteMeetingFilesHandler } from './delete-meeting-files.handler.js'

describe('DeleteMeetingFilesHandler', () => {
  let uploadsDir: string

  beforeEach(async () => {
    uploadsDir = await mkdtemp(join(tmpdir(), 'uploads-unit-'))
    process.env.UPLOADS_DIR = uploadsDir
  })

  afterEach(async () => {
    delete process.env.UPLOADS_DIR
    await rm(uploadsDir, { recursive: true, force: true })
  })

  it('удаляет каталог встречи со всеми файлами, не трогая другие встречи', async () => {
    await mkdir(join(uploadsDir, 'm1'))
    await mkdir(join(uploadsDir, 'm2'))
    await writeFile(join(uploadsDir, 'm1', 'a'), 'x')
    await writeFile(join(uploadsDir, 'm2', 'b'), 'x')

    await new DeleteMeetingFilesHandler().execute(new DeleteMeetingFilesCommand('m1'))

    expect(await readdir(uploadsDir)).toEqual(['m2'])
  })

  it('встреча без файлов (каталога нет) — не ошибка', async () => {
    await expect(
      new DeleteMeetingFilesHandler().execute(new DeleteMeetingFilesCommand('m1')),
    ).resolves.toBeUndefined()
  })

  it.each(['', '.', '..', '../m2', 'a/b'])(
    'отказывается удалять по небезопасному идентификатору "%s"',
    async (meetingId) => {
      await mkdir(join(uploadsDir, 'm2'))

      await expect(
        new DeleteMeetingFilesHandler().execute(new DeleteMeetingFilesCommand(meetingId)),
      ).rejects.toThrow('Недопустимый идентификатор')

      expect(await readdir(uploadsDir)).toEqual(['m2'])
    },
  )

  it('сбой удаления каталога только логируется', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    // каталог встречи лежит «внутри файла»: rm падает с ENOTDIR
    await writeFile(join(uploadsDir, 'm1'), 'не каталог')
    process.env.UPLOADS_DIR = join(uploadsDir, 'm1')

    await expect(
      new DeleteMeetingFilesHandler().execute(new DeleteMeetingFilesCommand('m1')),
    ).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Не удалось удалить каталог'))
    warn.mockRestore()
  })
})
