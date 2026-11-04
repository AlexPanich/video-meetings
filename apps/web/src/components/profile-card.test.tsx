import { render, screen } from '@testing-library/react'
import { ProfileCard } from './profile-card'

const user = {
  id: '1',
  email: 'ivan@example.com',
  name: 'Иван Петров',
  hasAvatar: false,
  avatarVersion: null,
}

describe('ProfileCard', () => {
  it('показывает инициалы, имя и email', () => {
    render(<ProfileCard user={user} />)
    expect(screen.getByText('ИП')).toBeInTheDocument()
    expect(screen.getByText('Иван Петров')).toBeInTheDocument()
    expect(screen.getByText('ivan@example.com')).toBeInTheDocument()
  })

  it('при hasAvatar показывает изображение с версией в URL вместо инициалов', () => {
    const { container } = render(
      <ProfileCard user={{ ...user, hasAvatar: true, avatarVersion: 42 }} />,
    )
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/profile/avatar?v=42')
    expect(screen.queryByText('ИП')).not.toBeInTheDocument()
  })

  it('«Редактировать» ведёт на /profile/edit', () => {
    render(<ProfileCard user={user} />)
    expect(screen.getByRole('link', { name: 'Редактировать' })).toHaveAttribute(
      'href',
      '/profile/edit',
    )
  })
})
