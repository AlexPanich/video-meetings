import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common'
import { hashPassword } from '../../auth/password.js'
import { ChangePasswordCommand } from './change-password.command.js'
import { ChangePasswordHandler } from './change-password.handler.js'

describe('ChangePasswordHandler', () => {
  const commandBus = { execute: vi.fn() }
  const queryBus = { execute: vi.fn() }
  const tokens = { issue: vi.fn() }
  let handler: ChangePasswordHandler
  let user: { id: string; passwordHash: string }

  beforeAll(async () => {
    user = { id: 'u1', passwordHash: await hashPassword('old-password') }
  })

  beforeEach(() => {
    vi.resetAllMocks()
    handler = new ChangePasswordHandler(commandBus as never, queryBus as never, tokens as never)
    queryBus.execute.mockResolvedValue(user)
  })

  it('меняет пароль и выдаёт токен для обновлённого пользователя', async () => {
    const updated = { ...user, tokenVersion: 1 }
    commandBus.execute.mockResolvedValue(updated)
    tokens.issue.mockResolvedValue({ accessToken: 't' })

    await expect(
      handler.execute(new ChangePasswordCommand('u1', 'old-password', 'new-password')),
    ).resolves.toEqual({ accessToken: 't' })
    expect(commandBus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', expectedHash: user.passwordHash }),
    )
    expect(tokens.issue).toHaveBeenCalledWith(updated)
  })

  it('неверный текущий пароль — 400, не 401, без записи', async () => {
    await expect(
      handler.execute(new ChangePasswordCommand('u1', 'wrong', 'new-password')),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('новый пароль совпадает с текущим — 400', async () => {
    await expect(
      handler.execute(new ChangePasswordCommand('u1', 'old-password', 'old-password')),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('пользователя нет — 401', async () => {
    queryBus.execute.mockResolvedValue(null)
    await expect(
      handler.execute(new ChangePasswordCommand('u1', 'old-password', 'new-password')),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('хеш изменился параллельно — 409', async () => {
    commandBus.execute.mockResolvedValue(null)
    await expect(
      handler.execute(new ChangePasswordCommand('u1', 'old-password', 'new-password')),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(tokens.issue).not.toHaveBeenCalled()
  })
})
