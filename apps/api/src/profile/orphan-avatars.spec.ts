import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Logger } from '@nestjs/common'
import { AVATAR_ORPHAN_MIN_AGE_MS } from './avatar.js'
import { removeOrphanAvatars } from './orphan-avatars.js'

describe('removeOrphanAvatars', () => {
  let uploadsDir: string
  let avatarsDir: string
  const logger = new Logger('test')

  const makePrisma = (referenced: string[]) => ({
    user: {
      findMany: vi
        .fn()
        .mockImplementation(({ where }: { where: { avatarStorageName: { in: string[] } } }) =>
          where.avatarStorageName.in
            .filter((name) => referenced.includes(name))
            .map((avatarStorageName) => ({ avatarStorageName })),
        ),
    },
  })

  const createFile = async (name: string, ageMs: number) => {
    const path = join(avatarsDir, name)
    await writeFile(path, 'x')
    const time = new Date(Date.now() - ageMs)
    await utimes(path, time, time)
  }

  beforeEach(async () => {
    uploadsDir = await mkdtemp(join(tmpdir(), 'avatars-unit-'))
    avatarsDir = join(uploadsDir, 'avatars')
    await mkdir(avatarsDir)
    process.env.UPLOADS_DIR = uploadsDir
    vi.spyOn(logger, 'log').mockImplementation(() => undefined)
  })

  afterEach(async () => {
    delete process.env.UPLOADS_DIR
    await rm(uploadsDir, { recursive: true, force: true })
  })

  it('удаляет старый файл без записи, остальное не трогает', async () => {
    const used = randomUUID()
    const oldOrphan = randomUUID()
    const freshOrphan = randomUUID()
    const foreign = 'notes.txt'
    const old = AVATAR_ORPHAN_MIN_AGE_MS + 60_000
    await createFile(used, old)
    await createFile(oldOrphan, old)
    await createFile(freshOrphan, 1000)
    await createFile(foreign, old)
    await mkdir(join(avatarsDir, randomUUID()))

    const removed = await removeOrphanAvatars(makePrisma([used]) as never, logger)

    expect(removed).toBe(1)
    const left = await readdir(avatarsDir)
    expect(left).not.toContain(oldOrphan)
    expect(left).toEqual(expect.arrayContaining([used, freshOrphan, foreign]))
  })

  it('не удаляет свежий файл без записи: он может быть ещё идущей загрузкой', async () => {
    const fresh = randomUUID()
    await createFile(fresh, 0)

    expect(await removeOrphanAvatars(makePrisma([]) as never, logger)).toBe(0)
    expect(await readdir(avatarsDir)).toContain(fresh)
  })

  it('без каталога avatars ничего не делает и не падает', async () => {
    await rm(avatarsDir, { recursive: true })
    const prisma = makePrisma([])

    expect(await removeOrphanAvatars(prisma as never, logger)).toBe(0)
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })
})
