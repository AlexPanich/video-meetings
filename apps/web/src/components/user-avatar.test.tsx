import { fireEvent, render, screen } from '@testing-library/react'
import { getInitials, UserAvatar } from './user-avatar'

afterEach(() => vi.restoreAllMocks())

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

describe('UserAvatar с изображением', () => {
  it('показывает изображение из /api/profile/avatar с версией в URL', () => {
    const { container } = render(
      <UserAvatar name="Иван Петров" hasAvatar avatarVersion={1700000000000} />,
    )
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      '/api/profile/avatar?v=1700000000000',
    )
    expect(screen.queryByText('ИП')).not.toBeInTheDocument()
  })

  it('без аватара показывает инициалы и не рисует изображение', () => {
    const { container } = render(<UserAvatar name="Иван Петров" hasAvatar={false} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('ИП')).toBeInTheDocument()
  })

  it('при ошибке загрузки изображения возвращается к инициалам', () => {
    const { container } = render(<UserAvatar name="Иван Петров" hasAvatar avatarVersion={1} />)
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('ИП')).toBeInTheDocument()
  })

  it('возвращается к инициалам, если изображение не загрузилось до гидратации', () => {
    // событие error уже прошло, и React его не увидит: остаётся состояние элемента
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0)
    const { container } = render(<UserAvatar name="Иван Петров" hasAvatar avatarVersion={1} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('ИП')).toBeInTheDocument()
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
