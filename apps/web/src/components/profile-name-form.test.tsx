import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileNameForm } from './profile-name-form'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

const submitWith = async (value: string) => {
  const user = userEvent.setup()
  const input = screen.getByLabelText('Имя')
  await user.clear(input)
  if (value) await user.type(input, value)
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
}

describe('ProfileNameForm', () => {
  it.each([
    ['пустого имени', ''],
    ['имени из пробелов', '   '],
  ])('показывает ошибку для %s и не отправляет запрос', async (_, value) => {
    render(<ProfileNameForm initialName="Иван" />)
    await submitWith(value)

    expect(await screen.findByText('Введите имя')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
