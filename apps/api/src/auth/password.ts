import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { ServiceUnavailableException } from '@nestjs/common'

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

// scrypt при N=2^17, r=8 занимает ~128 МиБ и выполняется в общем пуле libuv (по умолчанию 4 потока,
// их же используют fs и другие задачи). Число одновременных вычислений ограничено, лишние ждут в
// очереди ограниченной длины, а при её переполнении запрос получает 503. Пиковая память на хеши —
// `SCRYPT_CONCURRENCY` × ~128 МиБ (по умолчанию 2 → ~256 МиБ); `UV_THREADPOOL_SIZE` лучше держать
// больше этого значения, чтобы scrypt не занимал все потоки.
const positiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
const MAX_CONCURRENT = positiveInt(process.env.SCRYPT_CONCURRENCY, 2)
const MAX_QUEUED = positiveInt(process.env.SCRYPT_QUEUE_LIMIT, 32)

let running = 0
const waiting: Array<() => void> = []

async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) {
    if (waiting.length >= MAX_QUEUED) {
      throw new ServiceUnavailableException('Сервер перегружен, повторите попытку позже')
    }
    // слот передаётся ожидающему напрямую (running не уменьшается), чтобы очередь не обгоняли
    await new Promise<void>((resolve) => waiting.push(resolve))
  } else {
    running += 1
  }
  try {
    return await task()
  } finally {
    const next = waiting.shift()
    if (next) next()
    else running -= 1
  }
}

function derive(password: string, salt: Buffer, keyLength: number, params: ScryptParams) {
  return withSlot(() =>
    scryptAsync(password, salt, keyLength, {
      ...params,
      maxmem: 128 * params.N * params.r * MAX_MEM_FACTOR,
    }),
  )
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
  const matches = timingSafeEqual(actual, parsed.key)
  // Хеш со слабыми параметрами считается быстрее `DUMMY_HASH` (его проверка идёт на текущих
  // параметрах), и по времени ответа на неверный пароль отличался бы существующий аккаунт от
  // несуществующего. Добираем недостающую работу; при успехе хеш сразу перехешируется.
  if (!matches && isWeaker(parsed.params)) {
    await derive(password, parsed.salt, parsed.key.length, CURRENT)
  }
  return matches
}

const isWeaker = ({ N, r, p }: ScryptParams) => N < CURRENT.N || r < CURRENT.r || p < CURRENT.p

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
