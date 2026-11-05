import { randomBytes, scryptSync } from 'node:crypto'
import { ServiceUnavailableException } from '@nestjs/common'

type ScryptCall = [string, Buffer, number, { N: number }, (e: Error | null, k?: Buffer) => void]

// scrypt подменён обёрткой: считаем вызовы и видим параметры, реальное вычисление не меняется
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return { ...actual, scrypt: vi.fn(actual.scrypt) }
})

const { scrypt } = await import('node:crypto')
const scryptMock = vi.mocked(scrypt) as unknown as ReturnType<typeof vi.fn>

const legacyHash = (password: string) => {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`
}

const paramsOfCalls = () => scryptMock.mock.calls.map((call) => (call as ScryptCall)[3].N)

describe('verifyPassword: выравнивание времени для слабых хешей', () => {
  beforeEach(() => {
    vi.resetModules()
    scryptMock.mockClear()
  })

  it('неверный пароль для legacy-хеша: вторая проверка на текущих параметрах', async () => {
    const { verifyPassword } = await import('./password.js')
    const stored = legacyHash('secret-password')
    scryptMock.mockClear()

    await expect(verifyPassword('wrong-password', stored)).resolves.toBe(false)

    expect(paramsOfCalls()).toEqual([2 ** 14, 2 ** 17])
  })

  it('верный пароль для legacy-хеша: одно вычисление', async () => {
    const { verifyPassword } = await import('./password.js')
    const stored = legacyHash('secret-password')
    scryptMock.mockClear()

    await expect(verifyPassword('secret-password', stored)).resolves.toBe(true)

    expect(paramsOfCalls()).toEqual([2 ** 14])
  })

  it('неверный пароль для актуального хеша: одно вычисление', async () => {
    const { hashPassword, verifyPassword } = await import('./password.js')
    const stored = await hashPassword('secret-password')
    scryptMock.mockClear()

    await expect(verifyPassword('wrong-password', stored)).resolves.toBe(false)

    expect(paramsOfCalls()).toEqual([2 ** 17])
  })
})

describe('scrypt: ограничение параллельности', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    scryptMock.mockReset()
  })

  it('одновременно считается не больше SCRYPT_CONCURRENCY, переполнение очереди → 503', async () => {
    vi.stubEnv('SCRYPT_CONCURRENCY', '1')
    vi.stubEnv('SCRYPT_QUEUE_LIMIT', '1')
    vi.resetModules()
    let active = 0
    let maxActive = 0
    scryptMock.mockImplementation((...args: unknown[]) => {
      const callback = args[4] as ScryptCall[4]
      active += 1
      maxActive = Math.max(maxActive, active)
      setTimeout(() => {
        active -= 1
        callback(null, Buffer.alloc(64))
      }, 10)
    })
    const { verifyPassword } = await import('./password.js')
    const stored = `scrypt$${2 ** 17}$8$1$${'00'.repeat(16)}$${'00'.repeat(64)}`

    const results = await Promise.allSettled([
      verifyPassword('a', stored),
      verifyPassword('b', stored),
      verifyPassword('c', stored),
    ])

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'rejected'])
    expect((results[2] as PromiseRejectedResult).reason).toBeInstanceOf(ServiceUnavailableException)
    expect(maxActive).toBe(1)
  })

  it('после отказа и завершения слоты освобождаются', async () => {
    vi.stubEnv('SCRYPT_CONCURRENCY', '1')
    vi.stubEnv('SCRYPT_QUEUE_LIMIT', '1')
    vi.resetModules()
    scryptMock.mockImplementation((...args: unknown[]) => {
      ;(args[4] as ScryptCall[4])(null, Buffer.alloc(64))
    })
    const { verifyPassword } = await import('./password.js')
    const stored = `scrypt$${2 ** 17}$8$1$${'00'.repeat(16)}$${'00'.repeat(64)}`

    await Promise.allSettled([verifyPassword('a', stored), verifyPassword('b', stored)])

    await expect(verifyPassword('c', stored)).resolves.toBe(true)
  })
})
