import { parseTrustProxy } from './trust-proxy.js'

describe('parseTrustProxy', () => {
  it('по умолчанию не доверяет прокси', () => {
    expect(parseTrustProxy(undefined)).toBe(false)
    expect(parseTrustProxy('')).toBe(false)
    expect(parseTrustProxy('false')).toBe(false)
  })
  it('число прокси', () => expect(parseTrustProxy('1')).toBe(1))
  it('список адресов', () => expect(parseTrustProxy('loopback')).toBe('loopback'))
  it('true запрещён', () => expect(() => parseTrustProxy('true')).toThrow())
})
