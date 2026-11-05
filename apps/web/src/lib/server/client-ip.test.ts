// @vitest-environment node
import { clientIp, clientIpHeaders } from './client-ip'

const req = (forwardedFor?: string) =>
  new Request('http://localhost/', {
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
  })

afterEach(() => vi.unstubAllEnvs())

describe('clientIp', () => {
  it('без TRUSTED_PROXIES заголовку клиента не верим', () => {
    expect(clientIp(req('6.6.6.6'))).toBeUndefined()
    expect(clientIpHeaders(req('6.6.6.6'))).toEqual({})
  })

  it('берёт запись ближайшего доверенного прокси, а не подделку слева', () => {
    vi.stubEnv('TRUSTED_PROXIES', '1')
    expect(clientIp(req('6.6.6.6, 203.0.113.7'))).toBe('203.0.113.7')
  })

  it('учитывает несколько прокси', () => {
    vi.stubEnv('TRUSTED_PROXIES', '2')
    expect(clientIp(req('6.6.6.6, 203.0.113.7, 10.0.0.2'))).toBe('203.0.113.7')
  })

  it('не IP, короткая цепочка и нет заголовка → undefined', () => {
    vi.stubEnv('TRUSTED_PROXIES', '2')
    expect(clientIp(req('203.0.113.7'))).toBeUndefined()
    vi.stubEnv('TRUSTED_PROXIES', '1')
    expect(clientIp(req('evil'))).toBeUndefined()
    expect(clientIp(req())).toBeUndefined()
  })

  it('отдаёт заголовок с одним значением', () => {
    vi.stubEnv('TRUSTED_PROXIES', '1')
    expect(clientIpHeaders(req('6.6.6.6, 2001:db8::1'))).toEqual({
      'X-Forwarded-For': '2001:db8::1',
    })
  })
})
