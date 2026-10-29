import { render, screen } from '@testing-library/react'
import Page from './page'

// async-компонент с cookies() в jsdom не отрендерить — подменяем
vi.mock('@/components/user-greeting', () => ({ UserGreeting: () => <p>greeting</p> }))
vi.mock('@/components/meetings-overview', () => ({ MeetingsOverview: () => <p>meetings</p> }))

describe('Home page', () => {
  it('renders main heading', () => {
    render(<Page />)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })
})
