import { accountTracker, positiveIntFromEnv } from './rate-limit.module.js'

describe('accountTracker', () => {
  it('email приводится к нижнему регистру', () => {
    expect(accountTracker({ ip: '1.1.1.1', body: { email: '  A@B.com ' } })).toBe('email:a@b.com')
  })
  it('без email берёт userId, затем IP', () => {
    expect(accountTracker({ ip: '1.1.1.1', userId: 'u1', body: {} })).toBe('user:u1')
    expect(accountTracker({ ip: '1.1.1.1' })).toBe('ip:1.1.1.1')
  })
  it('нестроковый email игнорируется', () => {
    expect(accountTracker({ ip: '2.2.2.2', body: { email: { a: 1 } } })).toBe('ip:2.2.2.2')
  })
})

describe('accountTracker: приоритет токена', () => {
  it('userId важнее email из тела (клиент не выбирает ключ сам)', () => {
    expect(accountTracker({ userId: 'u1', body: { email: 'random@x.com' } })).toBe('user:u1')
  })
})

describe('positiveIntFromEnv', () => {
  it('разбирает положительные целые, иначе fallback', () => {
    expect(positiveIntFromEnv('5', 10)).toBe(5)
    expect(positiveIntFromEnv('0', 10)).toBe(10)
    expect(positiveIntFromEnv('abc', 10)).toBe(10)
    expect(positiveIntFromEnv(undefined, 10)).toBe(10)
  })
})
