import { render, screen } from '@testing-library/react'
import { UserAvatar } from './user-avatar'

describe('UserAvatar', () => {
  it('показывает инициалы имени и фамилии в верхнем регистре', () => {
    render(<UserAvatar name="иван петров" />)
    expect(screen.getByText('ИП')).toBeInTheDocument()
  })

  it('для одного слова показывает одну букву', () => {
    render(<UserAvatar name="Анна" />)
    expect(screen.getByText('А')).toBeInTheDocument()
  })
})
