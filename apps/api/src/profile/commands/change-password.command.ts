import { Command } from '@nestjs/cqrs'
import type { AuthResult } from '../../auth/token.service.js'

export class ChangePasswordCommand extends Command<AuthResult> {
  constructor(
    public readonly userId: string,
    public readonly currentPassword: string,
    public readonly newPassword: string,
  ) {
    super()
  }
}
