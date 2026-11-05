import { JWT_AUDIENCE, JWT_ISSUER, resolveJwtConfig } from './jwt-config.js'

const SECRET = 'a'.repeat(32)

describe('resolveJwtConfig', () => {
  it('JWT_SECRET не задан → ошибка', () => {
    expect(() => resolveJwtConfig({})).toThrow('JWT_SECRET')
    expect(() => resolveJwtConfig({ JWT_SECRET: '' })).toThrow('JWT_SECRET')
  })

  it('секрет короче 32 байт → ошибка', () => {
    expect(() => resolveJwtConfig({ JWT_SECRET: 'a'.repeat(31) })).toThrow('32')
  })

  it('длину считает в байтах, а не в символах', () => {
    // 16 кириллических символов = 32 байта
    expect(resolveJwtConfig({ JWT_SECRET: 'ы'.repeat(16) }).secret).toBe('ы'.repeat(16))
    expect(() => resolveJwtConfig({ JWT_SECRET: 'ы'.repeat(15) })).toThrow('32')
  })

  it('placeholder change-me → ошибка', () => {
    expect(() => resolveJwtConfig({ JWT_SECRET: 'change-me' })).toThrow()
    expect(() => resolveJwtConfig({ JWT_SECRET: 'change-me-'.repeat(5) })).toThrow('заглушкой')
  })

  it('по умолчанию токен живёт час, issuer и audience заданы', () => {
    const config = resolveJwtConfig({ JWT_SECRET: SECRET })
    expect(config).toEqual({
      secret: SECRET,
      expiresInSeconds: 3600,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    })
  })

  it.each([
    ['3600', 3600],
    ['30m', 1800],
    ['2h', 7200],
    ['1d', 86400],
    ['90s', 90],
    [' 1h ', 3600],
  ])('JWT_EXPIRES_IN=%s → %i с', (value, seconds) => {
    expect(resolveJwtConfig({ JWT_SECRET: SECRET, JWT_EXPIRES_IN: value }).expiresInSeconds).toBe(
      seconds,
    )
  })

  it.each(['', 'abc', '1x', '-5', '0', '0h', '1.5h', '1 h', 'Infinity'])(
    'JWT_EXPIRES_IN=%j не разбирается → ошибка',
    (value) => {
      expect(() => resolveJwtConfig({ JWT_SECRET: SECRET, JWT_EXPIRES_IN: value })).toThrow(
        'JWT_EXPIRES_IN',
      )
    },
  )

  it('больше 24 часов → ошибка', () => {
    expect(() => resolveJwtConfig({ JWT_SECRET: SECRET, JWT_EXPIRES_IN: '25h' })).toThrow(
      'JWT_EXPIRES_IN',
    )
    expect(() => resolveJwtConfig({ JWT_SECRET: SECRET, JWT_EXPIRES_IN: '2d' })).toThrow()
    expect(() => resolveJwtConfig({ JWT_SECRET: SECRET, JWT_EXPIRES_IN: '86401' })).toThrow()
    expect(resolveJwtConfig({ JWT_SECRET: SECRET, JWT_EXPIRES_IN: '24h' }).expiresInSeconds).toBe(
      86400,
    )
  })
})
