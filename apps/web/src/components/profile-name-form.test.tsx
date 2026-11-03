import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileNameForm } from './profile-name-form'

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  router.push.mockReset()
  router.refresh.mockReset()
  router.replace.mockReset()
})

const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as Response

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

  it.each([
    ['имени длиннее 100 символов', 'я'.repeat(101), 'Имя не длиннее 100 символов'],
    ['имени без буквы и цифры', '...', 'Имя должно содержать букву или цифру'],
  ])('показывает причину для %s и не отправляет запрос', async (_, value, message) => {
    render(<ProfileNameForm initialName="Иван" />)
    await submitWith(value)

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('отправляет имя без пробелов по краям и переходит в профиль с обновлением', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { id: '1', email: 'ivan@example.com', name: 'Пётр' }),
    )
    render(<ProfileNameForm initialName="Иван" />)
    await submitWith('  Пётр  ')

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/profile'))
    expect(router.refresh).toHaveBeenCalled()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/profile')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Пётр' })
  })

  it('показывает ошибку API и остаётся на странице', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { message: 'name содержит недопустимые символы' }),
    )
    render(<ProfileNameForm initialName="Иван" />)
    await submitWith('Пётр')

    expect(await screen.findByText('name содержит недопустимые символы')).toBeInTheDocument()
    expect(router.push).not.toHaveBeenCalled()
  })

  it('при 401 уводит на /login', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'Unauthorized' }))
    render(<ProfileNameForm initialName="Иван" />)
    await submitWith('Пётр')

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'))
    expect(router.push).not.toHaveBeenCalled()
  })
})
