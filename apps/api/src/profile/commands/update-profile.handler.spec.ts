import { UnauthorizedException } from '@nestjs/common'
import { UpdateUserNameCommand } from '../../users/commands/update-user-name.command.js'
import { UpdateProfileCommand } from './update-profile.command.js'
import { UpdateProfileHandler } from './update-profile.handler.js'

const user = { id: 'u1', email: 'alice@example.com', name: 'Alice', passwordHash: 'hash' }
const command = new UpdateProfileCommand(user.id, user.name)

describe('UpdateProfileHandler', () => {
  const commandBus = { execute: vi.fn() }
  let handler: UpdateProfileHandler

  beforeEach(() => {
    vi.resetAllMocks()
    handler = new UpdateProfileHandler(commandBus as never)
  })

  it('меняет имя через команду модуля users только у пользователя из команды', async () => {
    commandBus.execute.mockResolvedValue(user)

    await handler.execute(command)

    expect(commandBus.execute).toHaveBeenCalledTimes(1)
    const [sent] = commandBus.execute.mock.calls[0] as [unknown]
    expect(sent).toBeInstanceOf(UpdateUserNameCommand)
    expect(sent).toMatchObject({ userId: user.id, name: user.name })
  })

  it('возвращает PublicUser без passwordHash', async () => {
    commandBus.execute.mockResolvedValue(user)

    const result = await handler.execute(command)

    expect(result).toEqual({ id: user.id, email: user.email, name: user.name })
    expect(result).not.toHaveProperty('passwordHash')
  })

  it('бросает UnauthorizedException, если пользователя нет', async () => {
    commandBus.execute.mockResolvedValue(null)

    await expect(handler.execute(command)).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('пробрасывает ошибки шины как есть', async () => {
    const error = new Error('db down')
    commandBus.execute.mockRejectedValue(error)

    await expect(handler.execute(command)).rejects.toBe(error)
  })
})
