import { UpdateUserNameCommand } from './update-user-name.command.js'
import { UpdateUserNameHandler } from './update-user-name.handler.js'

const user = { id: 'u1', email: 'alice@example.com', name: 'Bob', passwordHash: 'hash' }
const command = new UpdateUserNameCommand(user.id, user.name)

describe('UpdateUserNameHandler', () => {
  const prisma = { user: { update: vi.fn() } }
  let handler: UpdateUserNameHandler

  beforeEach(() => {
    vi.resetAllMocks()
    handler = new UpdateUserNameHandler(prisma as never)
  })

  it('обновляет имя только у пользователя из команды и возвращает сущность', async () => {
    prisma.user.update.mockResolvedValue(user)

    const result = await handler.execute(command)

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { name: user.name },
    })
    expect(result).toBe(user)
  })

  it('возвращает null, если пользователя нет (P2025)', async () => {
    prisma.user.update.mockRejectedValue({ code: 'P2025' })

    await expect(handler.execute(command)).resolves.toBeNull()
  })

  it('пробрасывает прочие ошибки как есть', async () => {
    const error = new Error('db down')
    prisma.user.update.mockRejectedValue(error)

    await expect(handler.execute(command)).rejects.toBe(error)
  })
})
