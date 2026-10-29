import { Command } from '@nestjs/cqrs'
import type { AuthResult } from '../token.service.js'

export class RegisterUserCommand extends Command<AuthResult> {
  constructor(
    public readonly email: string,
    public readonly password: string,
    public readonly name: string,
  ) {
    super()
  }
}
