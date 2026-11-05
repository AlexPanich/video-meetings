import { type ExecutionContext, UnauthorizedException } from '@nestjs/common'
import type { QueryBus } from '@nestjs/cqrs'
import type { JwtService } from '@nestjs/jwt'
import { JwtAuthGuard } from './jwt-auth.guard.js'

const setup = (payload: unknown, tokenVersion: number | null, header = 'Bearer t') => {
  const jwt = {
    verifyAsync: vi
      .fn()
      .mockImplementation(() =>
        payload ? Promise.resolve(payload) : Promise.reject(new Error('bad')),
      ),
  }
  const queryBus = { execute: vi.fn().mockResolvedValue(tokenVersion) }
  const request: Record<string, unknown> = { headers: { authorization: header } }
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext
  const guard = new JwtAuthGuard(jwt as unknown as JwtService, queryBus as unknown as QueryBus)
  return { guard, context, request, queryBus }
}

describe('JwtAuthGuard', () => {
  it('пропускает токен с совпадающей версией и кладёт userId', async () => {
    const { guard, context, request } = setup({ sub: 'u1', ver: 2 }, 2)
    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(request.userId).toBe('u1')
  })

  it('401, если версия не совпадает', async () => {
    const { guard, context } = setup({ sub: 'u1', ver: 0 }, 1)
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('401, если пользователя нет', async () => {
    const { guard, context } = setup({ sub: 'u1', ver: 0 }, null)
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('401 для невалидного токена и без заголовка, БД не трогаем', async () => {
    const bad = setup(null, null)
    await expect(bad.guard.canActivate(bad.context)).rejects.toBeInstanceOf(UnauthorizedException)
    const none = setup({ sub: 'u1' }, null, '')
    await expect(none.guard.canActivate(none.context)).rejects.toBeInstanceOf(UnauthorizedException)
    expect(bad.queryBus.execute).not.toHaveBeenCalled()
    expect(none.queryBus.execute).not.toHaveBeenCalled()
  })

  it.each([
    ['sub не строка', { sub: 123, ver: 0 }],
    ['sub отсутствует', { ver: 0 }],
    ['sub пустой', { sub: '', ver: 0 }],
    ['ver отсутствует', { sub: 'u1' }],
    ['ver не число', { sub: 'u1', ver: '0' }],
    ['ver дробный', { sub: 'u1', ver: 1.5 }],
    ['ver null', { sub: 'u1', ver: null }],
    ['payload не объект', 'u1'],
  ])('401 при кривом payload: %s, БД не трогаем', async (_name, payload) => {
    const { guard, context, queryBus } = setup(payload, 0)
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException)
    expect(queryBus.execute).not.toHaveBeenCalled()
  })
})
