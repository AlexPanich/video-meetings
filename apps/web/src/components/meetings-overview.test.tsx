import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MeetingsOverview } from './meetings-overview'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}))

const getMeetings = vi.fn()
vi.mock('@/lib/server/meetings', () => ({ getMeetings: () => getMeetings() }))

describe('MeetingsOverview', () => {
  it('название встречи — ссылка на её страницу', async () => {
    getMeetings.mockResolvedValue([
      { id: 'm1', title: 'Планёрка', date: '2030-01-15T10:00:00.000Z', participants: ['a'] },
    ])
    render(await MeetingsOverview())

    expect(screen.getByRole('link', { name: 'Планёрка' })).toHaveAttribute('href', '/meetings/m1')
    expect(screen.getByText(/1 участн\./)).toBeInTheDocument()
  })

  it('кнопка «Создать встречу» открывает окно создания встречи', async () => {
    getMeetings.mockResolvedValue([])
    render(await MeetingsOverview())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Создать встречу' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Новая встреча' })).toBeInTheDocument()
  })
})
