import { Injectable } from '@nestjs/common'
import { normalizeIp } from '@nestjs/throttler'

const DEFAULT_LIMIT = 10
const DEFAULT_TTL_MS = 60_000
const MAX_LOCK_MS = 24 * 60 * 60 * 1000
const MAX_ENTRIES = 100_000
// на каждую неудачу по паре email+IP приходится до `limit`, по одному email со всех IP — до `limit * 3`
const EMAIL_LIMIT_FACTOR = 3

type PairEntry = { failures: number; resetAt: number }
type EmailEntry = { failures: number; level: number; lockedUntil: number; expiresAt: number }

const positiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Учёт неудачных попыток входа (в памяти процесса). Считаются только неверные пароли, успешный вход
 * сбрасывает счётчики.
 *  - пара `email + IP`: не больше `AUTH_RATE_LIMIT` неудач за окно `AUTH_RATE_LIMIT_TTL_MS`, затем
 *    блокировка до конца окна: владелец с другого IP при этом не страдает;
 *  - один email со всех IP: после `AUTH_RATE_LIMIT * 3` неудач подряд вход закрывается на окно,
 *    каждая следующая блокировка вдвое дольше (до суток). Это замедляет распределённый перебор.
 */
@Injectable()
export class LoginAttempts {
  private readonly limit = positiveInt(process.env.AUTH_RATE_LIMIT, DEFAULT_LIMIT)
  private readonly ttl = positiveInt(process.env.AUTH_RATE_LIMIT_TTL_MS, DEFAULT_TTL_MS)
  private readonly pairs = new Map<string, PairEntry>()
  private readonly emails = new Map<string, EmailEntry>()

  /** Сколько миллисекунд вход для этой пары закрыт (0 — можно пробовать). */
  retryAfterMs(email: string, ip: string, now = Date.now()): number {
    const pair = this.pairs.get(this.pairKey(email, ip))
    const byPair = pair && pair.failures >= this.limit ? pair.resetAt - now : 0
    const byEmail = (this.emails.get(email)?.lockedUntil ?? 0) - now
    return Math.max(byPair, byEmail, 0)
  }

  recordFailure(email: string, ip: string, now = Date.now()): void {
    this.sweep(now)
    const key = this.pairKey(email, ip)
    let pair = this.pairs.get(key)
    if (!pair || pair.resetAt <= now) pair = { failures: 0, resetAt: now + this.ttl }
    pair.failures += 1
    this.pairs.set(key, pair)

    const entry = this.emails.get(email) ?? { failures: 0, level: 0, lockedUntil: 0, expiresAt: 0 }
    entry.failures += 1
    if (entry.failures >= this.limit * EMAIL_LIMIT_FACTOR) {
      entry.lockedUntil = now + Math.min(this.ttl * 2 ** entry.level, MAX_LOCK_MS)
      entry.level += 1
      entry.failures = 0
    }
    // уровень «остывает» через сутки без неудач
    entry.expiresAt = Math.max(entry.lockedUntil, now + MAX_LOCK_MS)
    this.emails.set(email, entry)
  }

  recordSuccess(email: string, ip: string): void {
    this.pairs.delete(this.pairKey(email, ip))
    this.emails.delete(email)
  }

  private pairKey(email: string, ip: string) {
    return `${email}\n${normalizeIp(ip)}`
  }

  private sweep(now: number) {
    if (this.pairs.size + this.emails.size < MAX_ENTRIES) return
    for (const [key, entry] of this.pairs) if (entry.resetAt <= now) this.pairs.delete(key)
    for (const [key, entry] of this.emails) if (entry.expiresAt <= now) this.emails.delete(key)
    // всё ещё много: отбрасываем самые старые записи, чтобы память не росла бесконечно
    for (const map of [this.pairs, this.emails] as Map<string, unknown>[]) {
      for (const key of map.keys()) {
        if (map.size <= MAX_ENTRIES / 2) break
        map.delete(key)
      }
    }
  }
}
