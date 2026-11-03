import { UnauthorizedException } from '@nestjs/common'
import { UpdateProfileCommand } from './update-profile.command.js'
import { UpdateProfileHandler } from './update-profile.handler.js'

const user = { id: 'u1', email: 'alice@example.com', name: 'Alice', passwordHash: 'hash' }
const command = new UpdateProfileCommand(user.id, user.name)

describe('UpdateProfileHandler', () => {
  const prisma = { user: { update: vi.fn() } }
  let handler: UpdateProfileHandler

  beforeEach(() => {
    vi.resetAllMocks()
    handler = new UpdateProfileHandler(prisma as never)
  })

  it('обновляет имя только у пользователя из команды', async () => {
    prisma.user.update.mockResolvedValue(user)

    await handler.execute(command)

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { name: user.name },
    })
  })

  it('возвращает PublicUser без passwordHash', async () => {
    prisma.user.update.mockResolvedValue(user)

    const result = await handler.execute(command)

    expect(result).toEqual({ id: user.id, email: user.email, name: user.name })
    expect(result).not.toHaveProperty('passwordHash')
  })

  it('бросает UnauthorizedException, если пользователя нет (P2025)', async () => {
    prisma.user.update.mockRejectedValue({ code: 'P2025' })

    await expect(handler.execute(command)).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('пробрасывает прочие ошибки как есть', async () => {
    const error = new Error('db down')
    prisma.user.update.mockRejectedValue(error)

    await expect(handler.execute(command)).rejects.toBe(error)
  })
})
