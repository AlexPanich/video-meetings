import { UpgradeUserPasswordHashCommand } from './upgrade-user-password-hash.command.js'
import { UpgradeUserPasswordHashHandler } from './upgrade-user-password-hash.handler.js'

const command = new UpgradeUserPasswordHashCommand('u1', 'old', 'new')

describe('UpgradeUserPasswordHashHandler', () => {
  const prisma = { user: { updateMany: vi.fn() } }
  let handler: UpgradeUserPasswordHashHandler

  beforeEach(() => {
    vi.resetAllMocks()
    handler = new UpgradeUserPasswordHashHandler(prisma as never)
  })

  it('заменяет хеш, только если он не менялся, и не трогает tokenVersion', async () => {
    prisma.user.updateMany.mockResolvedValue({ count: 1 })

    await handler.execute(command)

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', passwordHash: 'old' },
      data: { passwordHash: 'new' },
    })
  })

  it('пробрасывает ошибки БД', async () => {
    const error = new Error('db down')
    prisma.user.updateMany.mockRejectedValue(error)
    await expect(handler.execute(command)).rejects.toBe(error)
  })
})
