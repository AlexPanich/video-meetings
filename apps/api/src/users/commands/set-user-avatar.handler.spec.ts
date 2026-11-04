import { SetUserAvatarCommand } from './set-user-avatar.command.js'
import { SetUserAvatarHandler } from './set-user-avatar.handler.js'

const command = new SetUserAvatarCommand('u1', 'new-name', 'image/png')

describe('SetUserAvatarHandler', () => {
  const tx = { $queryRaw: vi.fn(), user: { update: vi.fn() } }
  const prisma = {
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  }
  let handler: SetUserAvatarHandler

  beforeEach(() => {
    vi.clearAllMocks()
    handler = new SetUserAvatarHandler(prisma as never)
  })

  it('записывает аватар и возвращает имя прежнего файла', async () => {
    const user = { id: 'u1', avatarStorageName: 'new-name' }
    tx.$queryRaw.mockResolvedValue([{ avatarStorageName: 'old-name' }])
    tx.user.update.mockResolvedValue(user)

    const result = await handler.execute(command)

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: {
        avatarStorageName: 'new-name',
        avatarMimeType: 'image/png',
        avatarUpdatedAt: expect.any(Date) as Date,
      },
    })
    expect(result).toEqual({ user, previousStorageName: 'old-name' })
  })

  it('previousStorageName = null, если аватара раньше не было', async () => {
    tx.$queryRaw.mockResolvedValue([{ avatarStorageName: null }])
    tx.user.update.mockResolvedValue({ id: 'u1' })

    const result = await handler.execute(command)

    expect(result?.previousStorageName).toBeNull()
  })

  it('возвращает null, если пользователя нет', async () => {
    tx.$queryRaw.mockResolvedValue([])

    expect(await handler.execute(command)).toBeNull()
    expect(tx.user.update).not.toHaveBeenCalled()
  })
})
