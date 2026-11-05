import { LoginAttempts } from './login-attempts.js'

const EMAIL = 'a@example.com'
const NOW = 1_000_000

const create = (limit = 3, ttl = 60_000) => {
  vi.stubEnv('AUTH_RATE_LIMIT', String(limit))
  vi.stubEnv('AUTH_RATE_LIMIT_TTL_MS', String(ttl))
  return new LoginAttempts()
}

afterEach(() => vi.unstubAllEnvs())

describe('LoginAttempts: пара email+IP', () => {
  it('после limit неудач вход с этого IP закрыт до конца окна', () => {
    const attempts = create(3)
    for (let i = 0; i < 3; i++) attempts.recordFailure(EMAIL, '1.1.1.1', NOW)

    expect(attempts.retryAfterMs(EMAIL, '1.1.1.1', NOW + 1000)).toBe(59_000)
    expect(attempts.retryAfterMs(EMAIL, '1.1.1.1', NOW + 60_000)).toBe(0)
  })

  it('до лимита не блокирует, другой IP и другой email не затронуты', () => {
    const attempts = create(3)
    for (let i = 0; i < 2; i++) attempts.recordFailure(EMAIL, '1.1.1.1', NOW)
    expect(attempts.retryAfterMs(EMAIL, '1.1.1.1', NOW)).toBe(0)

    attempts.recordFailure(EMAIL, '1.1.1.1', NOW)
    expect(attempts.retryAfterMs(EMAIL, '2.2.2.2', NOW)).toBe(0)
    expect(attempts.retryAfterMs('b@example.com', '1.1.1.1', NOW)).toBe(0)
  })

  it('адреса одной IPv6-подсети /64 считаются одним клиентом', () => {
    const attempts = create(2)
    attempts.recordFailure(EMAIL, '2001:db8::1', NOW)
    attempts.recordFailure(EMAIL, '2001:db8::2', NOW)

    expect(attempts.retryAfterMs(EMAIL, '2001:db8::ffff', NOW)).toBeGreaterThan(0)
  })

  it('успешный вход сбрасывает счётчики', () => {
    const attempts = create(2)
    attempts.recordFailure(EMAIL, '1.1.1.1', NOW)
    attempts.recordFailure(EMAIL, '1.1.1.1', NOW)
    attempts.recordSuccess(EMAIL, '1.1.1.1')

    expect(attempts.retryAfterMs(EMAIL, '1.1.1.1', NOW)).toBe(0)
  })
})

describe('LoginAttempts: один email со всех IP', () => {
  const spray = (attempts: LoginAttempts, count: number, now: number, offset = 0) => {
    for (let i = 0; i < count; i++) attempts.recordFailure(EMAIL, `10.0.0.${i + offset}`, now)
  }

  it('после limit*3 неудач с разных IP закрывает вход всем, длительность растёт вдвое', () => {
    const attempts = create(3, 60_000)
    spray(attempts, 8, NOW)
    expect(attempts.retryAfterMs(EMAIL, '9.9.9.9', NOW)).toBe(0)

    spray(attempts, 1, NOW, 8)
    expect(attempts.retryAfterMs(EMAIL, '9.9.9.9', NOW)).toBe(60_000)

    const later = NOW + 61_000
    spray(attempts, 9, later, 20)
    expect(attempts.retryAfterMs(EMAIL, '9.9.9.9', later)).toBe(120_000)
  })

  it('успешный вход снимает блокировку и сбрасывает уровень', () => {
    const attempts = create(3, 60_000)
    spray(attempts, 9, NOW)
    attempts.recordSuccess(EMAIL, '9.9.9.9')

    expect(attempts.retryAfterMs(EMAIL, '9.9.9.9', NOW)).toBe(0)
    spray(attempts, 9, NOW, 30)
    expect(attempts.retryAfterMs(EMAIL, '9.9.9.9', NOW)).toBe(60_000)
  })

  it('блокировка не длиннее суток', () => {
    const attempts = create(1, 60 * 60 * 1000)
    let now = NOW
    for (let round = 0; round < 10; round++) {
      spray(attempts, 3, now, round * 10)
      now += 25 * 60 * 60 * 1000 - 1
    }
    expect(attempts.retryAfterMs(EMAIL, '9.9.9.9', now)).toBeLessThanOrEqual(24 * 60 * 60 * 1000)
  })
})
