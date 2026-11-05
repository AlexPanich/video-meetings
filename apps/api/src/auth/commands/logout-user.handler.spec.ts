import { RevokeUserTokensCommand } from '../../users/commands/revoke-user-tokens.command.js'
import { LogoutUserCommand } from './logout-user.command.js'
import { LogoutUserHandler } from './logout-user.handler.js'

describe('LogoutUserHandler', () => {
  it('отзывает токены пользователя через модуль users', async () => {
    const commandBus = { execute: vi.fn().mockResolvedValue(true) }
    const handler = new LogoutUserHandler(commandBus as never)

    await handler.execute(new LogoutUserCommand('u1'))

    expect(commandBus.execute).toHaveBeenCalledTimes(1)
    const sent = commandBus.execute.mock.calls[0][0] as RevokeUserTokensCommand
    expect(sent).toBeInstanceOf(RevokeUserTokensCommand)
    expect(sent.userId).toBe('u1')
  })
})
