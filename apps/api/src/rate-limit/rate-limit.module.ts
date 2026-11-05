import { Global, Module } from '@nestjs/common'
import { ThrottlerModule } from '@nestjs/throttler'

const DEFAULT_LIMIT = 10
const DEFAULT_TTL_MS = 60_000
const MAX_KEY_LENGTH = 254

export function positiveIntFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

type TrackedRequest = { ip?: string; userId?: string; body?: unknown }

/**
 * Ключ «по аккаунту»: userId из проверенного токена (клиент его подделать не может, поэтому он
 * приоритетнее тела), иначе email из тела (логин/регистрация), иначе IP.
 */
export function accountTracker(req: TrackedRequest): string {
  if (req.userId) return `user:${req.userId}`
  const email = (req.body as { email?: unknown } | undefined)?.email
  if (typeof email === 'string' && email.trim()) {
    return `email:${email.trim().toLowerCase().slice(0, MAX_KEY_LENGTH)}`
  }
  return `ip:${req.ip ?? 'unknown'}`
}

/**
 * Лимиты для дорогих (scrypt) и подбираемых эндпоинтов: отдельно по IP и по аккаунту.
 * Применяются только там, где явно подключён `ThrottlerGuard`.
 * Env: `AUTH_RATE_LIMIT` (запросов за окно, по умолчанию 10), `AUTH_RATE_LIMIT_TTL_MS` (60000).
 */
@Global()
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const limit = positiveIntFromEnv(process.env.AUTH_RATE_LIMIT, DEFAULT_LIMIT)
        const ttl = positiveIntFromEnv(process.env.AUTH_RATE_LIMIT_TTL_MS, DEFAULT_TTL_MS)
        return {
          throttlers: [
            { name: 'ip', limit, ttl, getTracker: (req: TrackedRequest) => req.ip ?? 'unknown' },
            { name: 'account', limit, ttl, getTracker: accountTracker },
          ],
        }
      },
    }),
  ],
  exports: [ThrottlerModule],
})
export class RateLimitModule {}
