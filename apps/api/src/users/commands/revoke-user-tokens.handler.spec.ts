import { RevokeUserTokensCommand } from './revoke-user-tokens.command.js'
import { RevokeUserTokensHandler } from './revoke-user-tokens.handler.js'

const command = new RevokeUserTokensCommand('u1')

describe('RevokeUserTokensHandler', () => {
  const prisma = { user: { update: vi.fn() } }
  let handler: RevokeUserTokensHandler

  beforeEach(() => {
    vi.resetAllMocks()
    handler = new RevokeUserTokensHandler(prisma as never)
  })

  it('увеличивает tokenVersion пользователя', async () => {
    prisma.user.update.mockResolvedValue({ id: 'u1' })

    await expect(handler.execute(command)).resolves.toBe(true)
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { tokenVersion: { increment: 1 } },
      select: { id: true },
    })
  })

  it('возвращает false, если пользователя нет (P2025)', async () => {
    prisma.user.update.mockRejectedValue({ code: 'P2025' })
    await expect(handler.execute(command)).resolves.toBe(false)
  })

  it('пробрасывает прочие ошибки', async () => {
    const error = new Error('db down')
    prisma.user.update.mockRejectedValue(error)
    await expect(handler.execute(command)).rejects.toBe(error)
  })
})
