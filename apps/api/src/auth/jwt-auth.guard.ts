import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'

export type AuthenticatedRequest = Request & { userId: string }

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const [scheme, token] = request.headers.authorization?.split(' ') ?? []
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException()
    }
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token)
      request.userId = payload.sub
      return true
    } catch {
      throw new UnauthorizedException()
    }
  }
}
