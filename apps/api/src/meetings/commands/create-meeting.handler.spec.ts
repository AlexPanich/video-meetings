import { CreateMeetingCommand } from './create-meeting.command.js'
import { CreateMeetingHandler } from './create-meeting.handler.js'

describe('CreateMeetingHandler', () => {
  const date = new Date('2030-01-15T10:00:00.000Z')

  const setup = () => {
    const prisma = {
      meeting: {
        create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'm1', createdAt: new Date(), ...data }),
        ),
      },
    }
    const handler = new CreateMeetingHandler(prisma as never)
    return { prisma, handler }
  }

  it('сохраняет участников без повторов (без учёта регистра, первое написание)', async () => {
    const { prisma, handler } = setup()

    const meeting = await handler.execute(
      new CreateMeetingCommand('u1', 'Планёрка', date, ['Алиса', 'Боб', 'алиса', 'БОБ']),
    )

    expect(prisma.meeting.create).toHaveBeenCalledWith({
      data: { ownerId: 'u1', title: 'Планёрка', date, participants: ['Алиса', 'Боб'] },
    })
    expect(meeting.participants).toEqual(['Алиса', 'Боб'])
  })

  it('создаёт встречу с пустым списком участников', async () => {
    const { prisma, handler } = setup()

    await handler.execute(new CreateMeetingCommand('u1', 'Планёрка', date, []))

    expect(prisma.meeting.create).toHaveBeenCalledWith({
      data: { ownerId: 'u1', title: 'Планёрка', date, participants: [] },
    })
  })
})
