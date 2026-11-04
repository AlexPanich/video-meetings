import { render, screen } from '@testing-library/react'
import { UserGreeting } from './user-greeting'

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/server/auth', () => ({
  getCurrentUser: async () => ({ id: '1', email: 'ivan@example.com', name: 'Иван Петров' }),
}))
vi.mock('./logout-button', () => ({ LogoutButton: () => <button>Выйти</button> }))

describe('UserGreeting', () => {
  it('содержит аватар со ссылкой на /profile', async () => {
    render(await UserGreeting())
    expect(screen.getByRole('link', { name: /профиль/i })).toHaveAttribute('href', '/profile')
    expect(screen.getByText('ИП')).toBeInTheDocument()
  })
})
