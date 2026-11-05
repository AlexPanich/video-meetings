import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

type ScryptParams = { N: number; r: number; p: number }

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptParams & { maxmem: number },
) => Promise<Buffer>

const KEY_LENGTH = 64
// Рекомендация OWASP: N не меньше 2^17
const CURRENT: ScryptParams = { N: 2 ** 17, r: 8, p: 1 }
// Хеши прежнего формата `salt:key` считались с дефолтами Node
const LEGACY: ScryptParams = { N: 2 ** 14, r: 8, p: 1 }
// scrypt требует памяти около 128 * N * r байт; берём с запасом
const MAX_MEM_FACTOR = 2

type Parsed = { params: ScryptParams; salt: Buffer; key: Buffer; legacy: boolean }

function derive(password: string, salt: Buffer, keyLength: number, params: ScryptParams) {
  return scryptAsync(password, salt, keyLength, {
    ...params,
    maxmem: 128 * params.N * params.r * MAX_MEM_FACTOR,
  })
}

const isHex = (value: string) =>
  value.length > 0 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value)

function parse(stored: string): Parsed | null {
  if (stored.startsWith('scrypt$')) {
    const [, n, r, p, saltHex, keyHex, ...rest] = stored.split('$')
    if (rest.length > 0 || !saltHex || !keyHex || !isHex(saltHex) || !isHex(keyHex)) return null
    const params = { N: Number(n), r: Number(r), p: Number(p) }
    const valid =
      Number.isInteger(params.N) &&
      params.N >= 2 &&
      params.N <= CURRENT.N &&
      (params.N & (params.N - 1)) === 0 &&
      Number.isInteger(params.r) &&
      params.r >= 1 &&
      params.r <= CURRENT.r &&
      Number.isInteger(params.p) &&
      params.p >= 1 &&
      params.p <= CURRENT.p
    if (!valid) return null
    return {
      params,
      salt: Buffer.from(saltHex, 'hex'),
      key: Buffer.from(keyHex, 'hex'),
      legacy: false,
    }
  }
  const [saltHex, keyHex, ...rest] = stored.split(':')
  if (rest.length > 0 || !saltHex || !keyHex || !isHex(saltHex) || !isHex(keyHex)) return null
  return {
    params: LEGACY,
    salt: Buffer.from(saltHex, 'hex'),
    key: Buffer.from(keyHex, 'hex'),
    legacy: true,
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt, KEY_LENGTH, CURRENT)
  const { N, r, p } = CURRENT
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${key.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored)
  if (!parsed) return false
  const actual = await derive(password, parsed.salt, parsed.key.length, parsed.params)
  return timingSafeEqual(actual, parsed.key)
}

// Параметры хеша при проверке не выше текущих (иначе parse вернёт null): так запись в БД не
// заставит процесс выделить гигабайты. Нераспознанный хеш считается устаревшим — вызывать
// только после успешного verifyPassword.
// true, если хеш в старом формате или посчитан с более слабыми параметрами, чем текущие
export function needsRehash(stored: string): boolean {
  const parsed = parse(stored)
  if (!parsed || parsed.legacy) return true
  const { N, r, p } = parsed.params
  return N < CURRENT.N || r < CURRENT.r || p < CURRENT.p
}
