import { render, screen } from '@testing-library/react'
import { getInitials, UserAvatar } from './user-avatar'

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

describe('getInitials', () => {
  it.each([
    ['Иван Петров', 'ИП'],
    ['  иван   петров  ', 'ИП'],
    ['Иван Петрович Сидоров', 'ИП'],
    ['«Иван» «Петров»', 'ИП'],
    ['- Иван', 'И'],
    ['(Админ)', 'А'],
    ['Иван - Петров', 'ИП'],
    ['​Иван', 'И'],
    ['Алекс 2', 'А2'],
    ['李小龍', '李'],
  ])('для %j даёт %j', (name, expected) => {
    expect(getInitials(name)).toBe(expected)
  })

  it('не разрезает символ вне BMP', () => {
    expect(getInitials('𠮷田 Тест')).toBe('𠮷Т')
  })

  it.each([[''], ['   '], ['...'], ['​']])('для имени без буквы и цифры %j даёт "?"', (name) => {
    expect(getInitials(name)).toBe('?')
  })
})
