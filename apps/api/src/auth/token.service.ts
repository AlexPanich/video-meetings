import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { type PublicUser, toPublicUser, type UserLike } from '../users/user.js'

export interface AuthResult {
  accessToken: string
  user: PublicUser
}

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  async issue(user: UserLike): Promise<AuthResult> {
    return {
      accessToken: await this.jwt.signAsync({ sub: user.id }),
      user: toPublicUser(user),
    }
  }
}
