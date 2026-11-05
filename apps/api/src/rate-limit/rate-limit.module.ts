import { Global, Module } from '@nestjs/common'
import { ThrottlerModule, normalizeIp } from '@nestjs/throttler'
import { LoginAttempts } from './login-attempts.js'
import { LoginAttemptsInterceptor } from './login-attempts.interceptor.js'
import { AppThrottlerGuard } from './throttler.guard.js'
import { TOO_MANY_REQUESTS_MESSAGE } from './messages.js'

const DEFAULT_LIMIT = 10
const DEFAULT_TTL_MS = 60_000
const MAX_KEY_LENGTH = 254

export function positiveIntFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

type TrackedRequest = { ip?: string; userId?: string; body?: unknown }

/**
 * Ключ троттлера `account`: userId из проверенного токена (клиент его подделать не может, поэтому он
 * приоритетнее тела), иначе email из тела (регистрация), иначе нормализованный IP.
 * Вход по паролю этим троттлером не ограничивается: там считаются только неудачные попытки
 * (`LoginAttempts`).
 */
export function accountTracker(req: TrackedRequest): string {
  if (req.userId) return `user:${req.userId}`
  const email = (req.body as { email?: unknown } | undefined)?.email
  if (typeof email === 'string' && email.trim()) {
    return `email:${email.trim().toLowerCase().slice(0, MAX_KEY_LENGTH)}`
  }
  return `ip:${normalizeIp(req.ip ?? 'unknown')}`
}

/**
 * Лимиты для дорогих (scrypt) и подбираемых эндпоинтов: `ip` (встроенный tracker throttler:
 * IPv6 сводится к /64) и `account`. Применяются только там, где явно подключён `AppThrottlerGuard`.
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
          errorMessage: TOO_MANY_REQUESTS_MESSAGE,
          throttlers: [
            { name: 'ip', limit, ttl },
            { name: 'account', limit, ttl, getTracker: accountTracker },
          ],
        }
      },
    }),
  ],
  providers: [LoginAttempts, LoginAttemptsInterceptor, AppThrottlerGuard],
  exports: [ThrottlerModule, LoginAttempts, LoginAttemptsInterceptor, AppThrottlerGuard],
})
export class RateLimitModule {}
