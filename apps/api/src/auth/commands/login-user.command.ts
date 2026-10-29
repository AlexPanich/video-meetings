import { Command } from '@nestjs/cqrs'
import type { AuthResult } from '../token.service.js'

export class LoginUserCommand extends Command<AuthResult> {
  constructor(
    public readonly email: string,
    public readonly password: string,
  ) {
    super()
  }
}
