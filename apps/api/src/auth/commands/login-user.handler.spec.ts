import { UnauthorizedException } from '@nestjs/common'
import { UpgradeUserPasswordHashCommand } from '../../users/commands/upgrade-user-password-hash.command.js'
import { hashPassword } from '../password.js'
import { LoginUserCommand } from './login-user.command.js'
import { LoginUserHandler } from './login-user.handler.js'

describe('LoginUserHandler', () => {
  const queryBus = { execute: vi.fn() }
  const commandBus = { execute: vi.fn() }
  const tokens = { issue: vi.fn() }
  let handler: LoginUserHandler

  beforeEach(() => {
    vi.resetAllMocks()
    handler = new LoginUserHandler(queryBus as never, commandBus as never, tokens as never)
  })

  it('перехеширует пароль со старыми параметрами после успешного входа', async () => {
    const legacy = await legacyHash('secret-password')
    const user = { id: 'u1', passwordHash: legacy }
    queryBus.execute.mockResolvedValue(user)
    tokens.issue.mockReturnValue({ accessToken: 't' })

    await expect(
      handler.execute(new LoginUserCommand('a@b.c', 'secret-password')),
    ).resolves.toEqual({ accessToken: 't' })

    expect(commandBus.execute).toHaveBeenCalledTimes(1)
    const command = commandBus.execute.mock.calls[0][0] as UpgradeUserPasswordHashCommand
    expect(command).toBeInstanceOf(UpgradeUserPasswordHashCommand)
    expect(command.userId).toBe('u1')
    expect(command.oldPasswordHash).toBe(legacy)
    expect(command.newPasswordHash.startsWith('scrypt$')).toBe(true)
  })

  it('не перехеширует актуальный хеш', async () => {
    const user = { id: 'u1', passwordHash: await hashPassword('secret-password') }
    queryBus.execute.mockResolvedValue(user)
    tokens.issue.mockReturnValue({ accessToken: 't' })

    await handler.execute(new LoginUserCommand('a@b.c', 'secret-password'))

    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('не перехеширует при неверном пароле', async () => {
    const legacy = await legacyHash('secret-password')
    queryBus.execute.mockResolvedValue({ id: 'u1', passwordHash: legacy })

    await expect(handler.execute(new LoginUserCommand('a@b.c', 'wrong'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('сбой перехеширования не мешает входу', async () => {
    const legacy = await legacyHash('secret-password')
    queryBus.execute.mockResolvedValue({ id: 'u1', passwordHash: legacy })
    commandBus.execute.mockRejectedValue(new Error('db down'))
    tokens.issue.mockReturnValue({ accessToken: 't' })

    await expect(
      handler.execute(new LoginUserCommand('a@b.c', 'secret-password')),
    ).resolves.toEqual({ accessToken: 't' })
  })
})

async function legacyHash(password: string): Promise<string> {
  const { randomBytes, scryptSync } = await import('node:crypto')
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`
}
