import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { User } from '../generated/prisma/client.js'
import { type PublicUser, toPublicUser, type UserLike } from '../users/user.js'

export interface AuthResult {
  accessToken: string
  user: PublicUser
}

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  async issue(user: UserLike & Pick<User, 'tokenVersion'>): Promise<AuthResult> {
    return {
      accessToken: await this.jwt.signAsync({ sub: user.id, ver: user.tokenVersion }),
      user: toPublicUser(user),
    }
  }
}
