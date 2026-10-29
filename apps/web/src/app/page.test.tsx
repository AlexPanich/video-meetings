import { render, screen } from '@testing-library/react'
import Page from './page'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

describe('Home page', () => {
  it('renders main heading', () => {
    render(<Page />)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it('shows login and register buttons for a guest', async () => {
    render(<Page />)
    expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Регистрация' })).toBeInTheDocument()
  })
})
