import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { QueryBus } from '@nestjs/cqrs'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import { FindUserByIdQuery } from '../users/queries/find-user-by-id.query.js'

export type AuthenticatedRequest = Request & { userId: string }

interface TokenPayload {
  sub: string
  ver?: number
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
    let payload: TokenPayload
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token)
    } catch {
      throw new UnauthorizedException()
    }
    const user = await this.queryBus.execute(new FindUserByIdQuery(payload.sub))
    // токен без версии считается версией 0: действующие сессии не обрываются при выкатке
    if (!user || user.tokenVersion !== (payload.ver ?? 0)) {
      throw new UnauthorizedException()
    }
    request.userId = payload.sub
    return true
  }
}
