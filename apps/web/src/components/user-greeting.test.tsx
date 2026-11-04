import { render, screen } from '@testing-library/react'
import { UserGreeting } from './user-greeting'

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
const currentUser = vi.hoisted(() => ({
  value: {
    id: '1',
    email: 'ivan@example.com',
    name: 'Иван Петров',
    hasAvatar: false,
    avatarVersion: null as number | null,
  },
}))
vi.mock('@/lib/server/auth', () => ({ getCurrentUser: async () => currentUser.value }))
vi.mock('./logout-button', () => ({ LogoutButton: () => <button>Выйти</button> }))

describe('UserGreeting', () => {
  afterEach(() => {
    currentUser.value = { ...currentUser.value, hasAvatar: false, avatarVersion: null }
  })

  it('при hasAvatar показывает изображение аватара с версией в URL', async () => {
    currentUser.value = { ...currentUser.value, hasAvatar: true, avatarVersion: 7 }
    const { container } = render(await UserGreeting())
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/profile/avatar?v=7')
    expect(screen.queryByText('ИП')).not.toBeInTheDocument()
  })

  it('содержит аватар со ссылкой на /profile', async () => {
    render(await UserGreeting())
    expect(screen.getByRole('link', { name: /профиль/i })).toHaveAttribute('href', '/profile')
    expect(screen.getByText('ИП')).toBeInTheDocument()
  })
})
