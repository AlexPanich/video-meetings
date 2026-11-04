// @vitest-environment node
import { NextRequest } from 'next/server'
import { config, proxy } from './proxy'

describe('proxy.ts', () => {
  it('закрывает главную и страницы встреч, но не /api (иначе буферизация тела загрузок)', () => {
    const matchers = [config.matcher].flat()
    expect(matchers).toEqual(expect.arrayContaining(['/', '/meetings/:path*']))
    expect(matchers.some((matcher) => matcher.startsWith('/api'))).toBe(false)
  })

  it('закрывает /profile и все страницы под ним', () => {
    expect([config.matcher].flat()).toContain('/profile/:path*')
  })

  it.each(['/profile', '/profile/edit'])('гость со страницы %s уходит на /login', (path) => {
    const guest = proxy(new NextRequest(`http://localhost${path}`))
    expect(guest.headers.get('location')).toBe('http://localhost/login')

    const user = proxy(
      new NextRequest(`http://localhost${path}`, { headers: { cookie: 'access-token=t' } }),
    )
    expect(user.headers.get('location')).toBeNull()
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
