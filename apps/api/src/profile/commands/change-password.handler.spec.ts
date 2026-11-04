import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common'
import { hashPassword } from '../../auth/password.js'
import type { ChangeUserPasswordCommand } from '../../users/commands/change-user-password.command.js'
import { ChangePasswordCommand } from './change-password.command.js'
import { ChangePasswordHandler } from './change-password.handler.js'

const stored = { id: 'u1', passwordHash: await hashPassword('old-password'), tokenVersion: 2 }
const result = { accessToken: 't', user: { id: 'u1' } }

describe('ChangePasswordHandler', () => {
  const commandBus = { execute: vi.fn() }
  const queryBus = { execute: vi.fn() }
  const tokens = { issue: vi.fn() }
  let handler: ChangePasswordHandler

  beforeEach(() => {
    vi.resetAllMocks()
    handler = new ChangePasswordHandler(commandBus as never, queryBus as never, tokens as never)
    queryBus.execute.mockResolvedValue(stored)
  })

  it('меняет пароль с ожидаемой версией и выпускает новый токен', async () => {
    const updated = { ...stored, tokenVersion: 3 }
    commandBus.execute.mockResolvedValue(updated)
    tokens.issue.mockResolvedValue(result)

    await expect(
      handler.execute(new ChangePasswordCommand('u1', 'old-password', 'new-password')),
    ).resolves.toBe(result)
    const cmd = commandBus.execute.mock.calls[0][0] as ChangeUserPasswordCommand
    expect(cmd.userId).toBe('u1')
    expect(cmd.expectedTokenVersion).toBe(2)
    expect(cmd.passwordHash).not.toBe('new-password')
    expect(tokens.issue).toHaveBeenCalledWith(updated)
  })

  it('неверный текущий пароль -> 403, ничего не пишет', async () => {
    await expect(
      handler.execute(new ChangePasswordCommand('u1', 'wrong', 'new-password')),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('новый пароль равен текущему -> 400', async () => {
    await expect(
      handler.execute(new ChangePasswordCommand('u1', 'old-password', 'old-password')),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('пользователя нет -> 401, параллельная смена -> 409', async () => {
    queryBus.execute.mockResolvedValue(null)
    await expect(
      handler.execute(new ChangePasswordCommand('u1', 'old-password', 'new-password')),
    ).rejects.toBeInstanceOf(UnauthorizedException)

    queryBus.execute.mockResolvedValue(stored)
    commandBus.execute.mockResolvedValue(null)
    await expect(
      handler.execute(new ChangePasswordCommand('u1', 'old-password', 'new-password')),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(tokens.issue).not.toHaveBeenCalled()
  })
})
