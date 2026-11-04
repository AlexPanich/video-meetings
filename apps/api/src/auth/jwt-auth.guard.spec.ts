import { UnauthorizedException } from '@nestjs/common'
import { JwtAuthGuard } from './jwt-auth.guard.js'

const contextWith = (authorization?: string) => {
  const request: { headers: { authorization?: string }; userId?: string } = {
    headers: { authorization },
  }
  return {
    request,
    context: { switchToHttp: () => ({ getRequest: () => request }) } as never,
  }
}

describe('JwtAuthGuard', () => {
  const jwt = { verifyAsync: vi.fn() }
  const queryBus = { execute: vi.fn() }
  let guard: JwtAuthGuard

  beforeEach(() => {
    vi.resetAllMocks()
    guard = new JwtAuthGuard(jwt as never, queryBus as never)
  })

  it('пропускает токен с совпавшей версией и кладёт userId', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1', ver: 2 })
    queryBus.execute.mockResolvedValue({ id: 'u1', tokenVersion: 2 })
    const { context, request } = contextWith('Bearer t')

    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(request.userId).toBe('u1')
  })

  it('токен без версии считается версией 0', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1' })
    queryBus.execute.mockResolvedValue({ id: 'u1', tokenVersion: 0 })

    await expect(guard.canActivate(contextWith('Bearer t').context)).resolves.toBe(true)
  })

  it('401, если версия не совпадает', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1', ver: 0 })
    queryBus.execute.mockResolvedValue({ id: 'u1', tokenVersion: 1 })

    await expect(guard.canActivate(contextWith('Bearer t').context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it('401, если пользователя нет', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1', ver: 0 })
    queryBus.execute.mockResolvedValue(null)

    await expect(guard.canActivate(contextWith('Bearer t').context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it('401 без заголовка и при невалидном токене, БД не опрашивается', async () => {
    await expect(guard.canActivate(contextWith().context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
    jwt.verifyAsync.mockRejectedValue(new Error('bad'))
    await expect(guard.canActivate(contextWith('Bearer t').context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
    expect(queryBus.execute).not.toHaveBeenCalled()
  })
})
