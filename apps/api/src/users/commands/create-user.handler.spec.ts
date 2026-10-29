import { ConflictException } from '@nestjs/common'
import { CreateUserCommand } from './create-user.command.js'
import { CreateUserHandler } from './create-user.handler.js'

const user = { id: 'u1', email: 'alice@example.com', name: 'Alice', passwordHash: 'hash' }
const command = new CreateUserCommand(user.email, user.name, user.passwordHash)

describe('CreateUserHandler', () => {
  const prisma = { user: { create: vi.fn() } }
  let handler: CreateUserHandler

  beforeEach(() => {
    vi.resetAllMocks()
    handler = new CreateUserHandler(prisma as never)
  })

  it('создаёт пользователя', async () => {
    prisma.user.create.mockResolvedValue(user)

    await expect(handler.execute(command)).resolves.toBe(user)
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { email: user.email, name: user.name, passwordHash: user.passwordHash },
    })
  })

  it('бросает ConflictException при нарушении уникальности email (P2002)', async () => {
    prisma.user.create.mockRejectedValue({ code: 'P2002' })

    await expect(handler.execute(command)).rejects.toBeInstanceOf(ConflictException)
  })

  it('пробрасывает прочие ошибки как есть', async () => {
    const error = new Error('db down')
    prisma.user.create.mockRejectedValue(error)

    await expect(handler.execute(command)).rejects.toBe(error)
  })
})
