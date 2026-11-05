import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnauthorizedException,
} from '@nestjs/common'
import { ThrottlerException } from '@nestjs/throttler'
import type { Request, Response } from 'express'
import { type Observable, catchError, tap, throwError } from 'rxjs'
import { LoginAttempts } from './login-attempts.js'
import { TOO_MANY_REQUESTS_MESSAGE } from './messages.js'

const MAX_EMAIL_LENGTH = 254

/**
 * Для `POST /auth/login`: до обработчика проверяет блокировку (429 + `Retry-After`, scrypt не
 * запускается), после него учитывает результат: 401 — неудача, успех — сброс счётчиков.
 * Тело здесь ещё не прошло валидацию, поэтому email нормализуется так же, как в `LoginDto`.
 */
@Injectable()
export class LoginAttemptsInterceptor implements NestInterceptor {
  constructor(private readonly attempts: LoginAttempts) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp()
    const req = http.getRequest<Request>()
    const raw = (req.body as { email?: unknown } | undefined)?.email
    if (typeof raw !== 'string' || !raw.trim()) return next.handle()
    const email = raw.trim().toLowerCase().slice(0, MAX_EMAIL_LENGTH)
    const ip = req.ip ?? 'unknown'

    const retryAfterMs = this.attempts.retryAfterMs(email, ip)
    if (retryAfterMs > 0) {
      http.getResponse<Response>().setHeader('Retry-After', Math.ceil(retryAfterMs / 1000))
      throw new ThrottlerException(TOO_MANY_REQUESTS_MESSAGE)
    }
    return next.handle().pipe(
      tap(() => this.attempts.recordSuccess(email, ip)),
      catchError((error: unknown) => {
        if (error instanceof UnauthorizedException) this.attempts.recordFailure(email, ip)
        return throwError(() => error)
      }),
    )
  }
}
