import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
})
