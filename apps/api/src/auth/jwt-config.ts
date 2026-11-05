import { Buffer } from 'node:buffer'

export const JWT_ISSUER = 'video-meetings-api'
export const JWT_AUDIENCE = 'video-meetings'

/** Минимальная длина секрета HS256 в байтах (размер выхода SHA-256). */
export const JWT_SECRET_MIN_BYTES = 32
/** Верхняя граница срока жизни токена: 24 часа. */
export const JWT_EXPIRES_MAX_SECONDS = 24 * 60 * 60
const DEFAULT_EXPIRES_IN = '1h'
const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }

export interface JwtConfig {
  secret: string
  expiresInSeconds: number
  issuer: string
  audience: string
}

/** `3600` (секунды) или число с единицей `s|m|h|d`; иначе `null`. */
function parseDuration(value: string): number | null {
  const match = /^(\d+)([smhd])?$/.exec(value.trim())
  if (!match) return null
  const seconds = Number(match[1]) * (match[2] ? UNIT_SECONDS[match[2]] : 1)
  return Number.isSafeInteger(seconds) ? seconds : null
}

/** Читает и проверяет JWT-конфигурацию из env; при некорректных значениях бросает ошибку (старт падает). */
export function resolveJwtConfig(env: NodeJS.ProcessEnv): JwtConfig {
  const secret = env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET не задан')
  if (secret.toLowerCase().startsWith('change-me')) {
    throw new Error('JWT_SECRET остался заглушкой: сгенерируйте `openssl rand -base64 48`')
  }
  if (Buffer.byteLength(secret) < JWT_SECRET_MIN_BYTES) {
    throw new Error(
      `JWT_SECRET короче ${JWT_SECRET_MIN_BYTES} байт: сгенерируйте \`openssl rand -base64 48\``,
    )
  }

  const rawExpires = env.JWT_EXPIRES_IN ?? DEFAULT_EXPIRES_IN
  const expiresInSeconds = parseDuration(rawExpires)
  if (expiresInSeconds === null || expiresInSeconds <= 0) {
    throw new Error(
      `JWT_EXPIRES_IN=${JSON.stringify(rawExpires)} не разбирается: ожидается число секунд или число с суффиксом s, m, h, d (например 1h)`,
    )
  }
  if (expiresInSeconds > JWT_EXPIRES_MAX_SECONDS) {
    throw new Error('JWT_EXPIRES_IN больше 24 часов')
  }

  return { secret, expiresInSeconds, issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
}
