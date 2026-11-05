import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { QueryBus } from '@nestjs/cqrs'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import { GetUserTokenVersionQuery } from '../users/queries/get-user-token-version.query.js'

export type AuthenticatedRequest = Request & { userId: string }

interface TokenPayload {
  sub: string
  ver: number
}

function isTokenPayload(payload: unknown): payload is TokenPayload {
  if (typeof payload !== 'object' || payload === null) return false
  const { sub, ver } = payload as Record<string, unknown>
  return (
    typeof sub === 'string' && sub.length > 0 && typeof ver === 'number' && Number.isInteger(ver)
  )
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly queryBus: QueryBus,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const [scheme, token] = request.headers.authorization?.split(' ') ?? []
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException()
    }
    let payload: unknown
    try {
      payload = await this.jwt.verifyAsync<object>(token)
    } catch {
      throw new UnauthorizedException()
    }
    // подпись верна, но форма payload чужая: 401, а не 500 из запроса к БД
    if (!isTokenPayload(payload)) {
      throw new UnauthorizedException()
    }
    const tokenVersion = await this.queryBus.execute(new GetUserTokenVersionQuery(payload.sub))
    if (tokenVersion === null || tokenVersion !== payload.ver) {
      throw new UnauthorizedException()
    }
    request.userId = payload.sub
    return true
  }
}
