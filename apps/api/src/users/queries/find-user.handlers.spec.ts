import { FindUserByEmailHandler } from './find-user-by-email.handler.js'
import { FindUserByEmailQuery } from './find-user-by-email.query.js'
import { FindUserByIdHandler } from './find-user-by-id.handler.js'
import { FindUserByIdQuery } from './find-user-by-id.query.js'
import { GetUserTokenVersionHandler } from './get-user-token-version.handler.js'
import { GetUserTokenVersionQuery } from './get-user-token-version.query.js'

const user = { id: 'u1', email: 'alice@example.com', name: 'Alice', passwordHash: 'hash' }

describe('запросы поиска пользователя', () => {
  const prisma = { user: { findUnique: vi.fn() } }

  beforeEach(() => vi.resetAllMocks())

  it('FindUserByEmailHandler ищет пользователя по email', async () => {
    prisma.user.findUnique.mockResolvedValue(user)

    const handler = new FindUserByEmailHandler(prisma as never)

    await expect(handler.execute(new FindUserByEmailQuery(user.email))).resolves.toBe(user)
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: user.email } })
  })

  it('FindUserByIdHandler возвращает null, если пользователя нет', async () => {
    prisma.user.findUnique.mockResolvedValue(null)

    const handler = new FindUserByIdHandler(prisma as never)

    await expect(handler.execute(new FindUserByIdQuery('missing'))).resolves.toBeNull()
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'missing' } })
  })

  it('GetUserTokenVersionHandler читает только tokenVersion', async () => {
    prisma.user.findUnique.mockResolvedValue({ tokenVersion: 3 })

    const handler = new GetUserTokenVersionHandler(prisma as never)

    await expect(handler.execute(new GetUserTokenVersionQuery('u1'))).resolves.toBe(3)
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { tokenVersion: true },
    })
  })

  it('GetUserTokenVersionHandler возвращает null, если пользователя нет', async () => {
    prisma.user.findUnique.mockResolvedValue(null)

    const handler = new GetUserTokenVersionHandler(prisma as never)

    await expect(handler.execute(new GetUserTokenVersionQuery('missing'))).resolves.toBeNull()
  })
})
