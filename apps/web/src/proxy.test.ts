// @vitest-environment node
import { NextRequest } from 'next/server'
import { config, proxy } from './proxy'

describe('proxy.ts', () => {
  it('закрывает главную и страницы встреч, но не /api (иначе буферизация тела загрузок)', () => {
    const matchers = [config.matcher].flat()
    expect(matchers).toEqual(expect.arrayContaining(['/', '/meetings/:path*']))
    expect(matchers.some((matcher) => matcher.startsWith('/api'))).toBe(false)
  })

  it('гость уходит на /login, пользователь с cookie проходит', () => {
    const guest = proxy(new NextRequest('http://localhost/meetings/m1'))
    expect(guest.headers.get('location')).toBe('http://localhost/login')

    const user = proxy(
      new NextRequest('http://localhost/meetings/m1', { headers: { cookie: 'access-token=t' } }),
    )
    expect(user.headers.get('location')).toBeNull()
  })
})
