import { render, screen } from '@testing-library/react'
import { ProfileCard } from './profile-card'

const user = { id: '1', email: 'ivan@example.com', name: 'Иван Петров' }

describe('ProfileCard', () => {
  it('показывает инициалы, имя и email', () => {
    render(<ProfileCard user={user} />)
    expect(screen.getByText('ИП')).toBeInTheDocument()
    expect(screen.getByText('Иван Петров')).toBeInTheDocument()
    expect(screen.getByText('ivan@example.com')).toBeInTheDocument()
  })

  it('«Редактировать» ведёт на /profile/edit', () => {
    render(<ProfileCard user={user} />)
    expect(screen.getByRole('link', { name: 'Редактировать' })).toHaveAttribute(
      'href',
      '/profile/edit',
    )
  })
})
