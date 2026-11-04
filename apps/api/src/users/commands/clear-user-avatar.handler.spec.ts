import { ClearUserAvatarCommand } from './clear-user-avatar.command.js'
import { ClearUserAvatarHandler } from './clear-user-avatar.handler.js'

describe('ClearUserAvatarHandler', () => {
  const tx = { $queryRaw: vi.fn(), user: { update: vi.fn() } }
  const prisma = { $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)) }
  let handler: ClearUserAvatarHandler

  beforeEach(() => {
    vi.clearAllMocks()
    handler = new ClearUserAvatarHandler(prisma as never)
  })

  it('очищает поля аватара и возвращает имя файла', async () => {
    tx.$queryRaw.mockResolvedValue([{ avatarStorageName: 'old' }])

    const result = await handler.execute(new ClearUserAvatarCommand('u1'))

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { avatarStorageName: null, avatarMimeType: null, avatarUpdatedAt: null },
    })
    expect(result).toEqual({ previousStorageName: 'old' })
  })

  it('без аватара ничего не пишет и возвращает previousStorageName = null', async () => {
    tx.$queryRaw.mockResolvedValue([{ avatarStorageName: null }])

    expect(await handler.execute(new ClearUserAvatarCommand('u1'))).toEqual({
      previousStorageName: null,
    })
    expect(tx.user.update).not.toHaveBeenCalled()
  })

  it('возвращает null, если пользователя нет', async () => {
    tx.$queryRaw.mockResolvedValue([])

    expect(await handler.execute(new ClearUserAvatarCommand('u1'))).toBeNull()
  })
})
