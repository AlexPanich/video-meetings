import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Logger } from '@nestjs/common'
import { removeOrphanFiles } from './orphan-files.js'

describe('removeOrphanFiles', () => {
  let uploadsDir: string
  const logger = new Logger('test')

  beforeEach(async () => {
    uploadsDir = await mkdtemp(join(tmpdir(), 'uploads-unit-'))
    process.env.UPLOADS_DIR = uploadsDir
    vi.spyOn(logger, 'log').mockImplementation(() => undefined)
  })

  afterEach(async () => {
    delete process.env.UPLOADS_DIR
    await rm(uploadsDir, { recursive: true, force: true })
  })

  const makePrisma = (meetingIds: string[], storageNames: string[]) => ({
    meeting: {
      findMany: vi
        .fn()
        .mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.filter((id) => meetingIds.includes(id)).map((id) => ({ id })),
        ),
    },
    meetingFile: {
      findMany: vi
        .fn()
        .mockImplementation(({ where }: { where: { storageName: { in: string[] } } }) =>
          where.storageName.in
            .filter((name) => storageNames.includes(name))
            .map((storageName) => ({ storageName })),
        ),
    },
  })

  it('удаляет каталог несуществующей встречи и файл без записи, остальное не трогает', async () => {
    const alive = randomUUID()
    const dead = randomUUID()
    const known = randomUUID()
    const orphan = randomUUID()
    await mkdir(join(uploadsDir, alive))
    await mkdir(join(uploadsDir, dead))
    await writeFile(join(uploadsDir, dead, randomUUID()), 'x')
    await writeFile(join(uploadsDir, alive, known), 'x')
    await writeFile(join(uploadsDir, alive, orphan), 'x')

    const removed = await removeOrphanFiles(makePrisma([alive], [known]) as never, logger)

    expect(removed).toBe(2)
    expect(await readdir(uploadsDir)).toEqual([alive])
    expect(await readdir(join(uploadsDir, alive))).toEqual([known])
  })

  it('не трогает посторонние имена, не похожие на uuid', async () => {
    await mkdir(join(uploadsDir, 'important-docs'))
    await writeFile(join(uploadsDir, 'notes.txt'), 'x')
    const prisma = makePrisma([], [])

    expect(await removeOrphanFiles(prisma as never, logger)).toBe(0)

    expect((await readdir(uploadsDir)).sort()).toEqual(['important-docs', 'notes.txt'])
    expect(prisma.meeting.findMany).not.toHaveBeenCalled()
  })

  it('нет каталога хранения — не ошибка', async () => {
    process.env.UPLOADS_DIR = join(uploadsDir, 'missing')

    expect(await removeOrphanFiles(makePrisma([], []) as never, logger)).toBe(0)
  })
})
