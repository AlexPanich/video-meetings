import { randomBytes, scrypt } from 'node:crypto'
import { promisify } from 'node:util'
import { hashPassword, needsRehash, verifyPassword } from './password.js'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

async function legacyHash(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scryptAsync(password, salt, 64)
  return `${salt.toString('hex')}:${key.toString('hex')}`
}

describe('password', () => {
  it('хранит параметры в формате scrypt$N$r$p$salt$key с N = 2^17', async () => {
    const hash = await hashPassword('secret-password')
    const [id, n, r, p, salt, key] = hash.split('$')

    expect(id).toBe('scrypt')
    expect(Number(n)).toBe(2 ** 17)
    expect(Number(r)).toBe(8)
    expect(Number(p)).toBe(1)
    expect(salt).toMatch(/^[0-9a-f]{32}$/)
    expect(key).toMatch(/^[0-9a-f]{128}$/)
  })

  it('проверяет верный и неверный пароль', async () => {
    const hash = await hashPassword('secret-password')

    await expect(verifyPassword('secret-password', hash)).resolves.toBe(true)
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false)
  })

  it('распознаёт старый формат salt:key', async () => {
    const legacy = await legacyHash('secret-password')

    await expect(verifyPassword('secret-password', legacy)).resolves.toBe(true)
    await expect(verifyPassword('wrong-password', legacy)).resolves.toBe(false)
  })

  it('needsRehash: true для старого формата и устаревших параметров, false для актуальных', async () => {
    expect(needsRehash(await legacyHash('x'))).toBe(true)
    expect(needsRehash(`scrypt$${2 ** 14}$8$1$${'00'.repeat(16)}$${'00'.repeat(64)}`)).toBe(true)
    expect(needsRehash(await hashPassword('x'))).toBe(false)
  })

  it('битый хеш не подходит и не бросает исключение', async () => {
    await expect(verifyPassword('x', 'garbage')).resolves.toBe(false)
    await expect(verifyPassword('x', 'scrypt$a$b$c$zz$yy')).resolves.toBe(false)
  })
})
