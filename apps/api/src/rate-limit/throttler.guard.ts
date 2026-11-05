import { ExecutionContext, Injectable } from '@nestjs/common'
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler'
import type { Response } from 'express'

/**
 * `ThrottlerGuard` со стандартным `Retry-After`: у именованных троттлеров заголовок получает суффикс
 * (`Retry-After-ip`), и клиент его не увидит. Сообщение берётся из `errorMessage` модуля.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const res = context.switchToHttp().getResponse<Response>()
    const seconds = Math.max(1, Math.ceil(detail.timeToBlockExpire))
    res.setHeader('Retry-After', seconds)
    await super.throwThrottlingException(context, detail)
  }
}
