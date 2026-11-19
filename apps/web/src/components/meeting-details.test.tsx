import { render, screen, within } from '@testing-library/react'
import { MeetingDetails } from './meeting-details'

const getMeeting = vi.fn()
vi.mock('@/lib/server/meetings', () => ({ getMeeting: (id: string) => getMeeting(id) }))
vi.mock('./meeting-files', () => ({
  MeetingFiles: ({ meetingId }: { meetingId: string }) => <p>files:{meetingId}</p>,
}))
vi.mock('./meeting-summary', () => ({
  MeetingSummary: ({ meetingId }: { meetingId: string }) => <p>summary:{meetingId}</p>,
}))
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`)
})
const notFound = vi.fn(() => {
  throw new Error('NOT_FOUND')
})
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirect(url),
  notFound: () => notFound(),
}))

const meeting = {
  id: 'm1',
  title: 'Планёрка',
  date: '2030-01-15T10:00:00.000Z',
  participants: ['a', 'b'],
  ownerId: 'u1',
}
const render_ = async () => render(await MeetingDetails({ params: Promise.resolve({ id: 'm1' }) }))

beforeEach(() => {
  getMeeting.mockReset()
  redirect.mockClear()
  notFound.mockClear()
})

describe('MeetingDetails', () => {
  it('показывает встречу, блок файлов и блок саммари этой встречи', async () => {
    getMeeting.mockResolvedValue({ ok: true, data: meeting })
    await render_()

    expect(screen.getByRole('heading', { level: 1, name: 'Планёрка' })).toBeInTheDocument()
    expect(screen.getByText(/2 участн\./)).toBeInTheDocument()
    expect(screen.getByText('files:m1')).toBeInTheDocument()
    expect(screen.getByText('summary:m1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Все встречи/ })).toHaveAttribute('href', '/')
  })

  it('показывает имена участников списком в порядке ввода', async () => {
    getMeeting.mockResolvedValue({
      ok: true,
      data: { ...meeting, participants: ['Анна Петрова', 'Борис', 'Вера'] },
    })
    await render_()

    const list = screen.getByRole('list', { name: 'Участники' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Анна Петрова', 'Борис', 'Вера'])
  })

  it('без участников списка нет', async () => {
    getMeeting.mockResolvedValue({ ok: true, data: { ...meeting, participants: [] } })
    await render_()

    expect(screen.getByText(/0 участн\./)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Участники' })).not.toBeInTheDocument()
  })

  it('токен отклонён — редирект на /login', async () => {
    getMeeting.mockResolvedValue({ ok: false, status: 401 })

    await expect(render_()).rejects.toThrow('REDIRECT:/login')
  })

  it('встречи нет или она чужая — 404', async () => {
    getMeeting.mockResolvedValue({ ok: false, status: 404 })

    await expect(render_()).rejects.toThrow('NOT_FOUND')
  })

  it.each([500, 0])('временный сбой (%i) — сообщение, а не 404', async (status) => {
    getMeeting.mockResolvedValue({ ok: false, status })
    await render_()

    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить встречу')
    expect(screen.queryByText(/^summary:/)).not.toBeInTheDocument()
    expect(notFound).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })
})
