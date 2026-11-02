import { render, screen } from '@testing-library/react'
import { MeetingsOverview } from './meetings-overview'

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
})
