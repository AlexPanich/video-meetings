import { ChangeUserPasswordCommand } from './change-user-password.command.js'
import { ChangeUserPasswordHandler } from './change-user-password.handler.js'

const user = { id: 'u1', passwordHash: 'new', tokenVersion: 4 }
const command = new ChangeUserPasswordCommand('u1', 'new', 3)

describe('ChangeUserPasswordHandler', () => {
  const prisma = { user: { update: vi.fn() } }
  let handler: ChangeUserPasswordHandler

  beforeEach(() => {
    vi.resetAllMocks()
    handler = new ChangeUserPasswordHandler(prisma as never)
  })

  it('одним запросом меняет хеш и увеличивает версию при совпадении версии', async () => {
    prisma.user.update.mockResolvedValue(user)

    await expect(handler.execute(command)).resolves.toBe(user)
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1', tokenVersion: 3 },
      data: { passwordHash: 'new', tokenVersion: { increment: 1 } },
    })
  })

  it('возвращает null, если пользователя нет или версия сменилась (P2025)', async () => {
    prisma.user.update.mockRejectedValue({ code: 'P2025' })
    await expect(handler.execute(command)).resolves.toBeNull()
  })

  it('пробрасывает прочие ошибки', async () => {
    const error = new Error('db down')
    prisma.user.update.mockRejectedValue(error)
    await expect(handler.execute(command)).rejects.toBe(error)
  })
})
