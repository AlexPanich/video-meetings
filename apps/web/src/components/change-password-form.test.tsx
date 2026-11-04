import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChangePasswordForm } from './change-password-form'

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

const fill = async (current: string, next: string, repeat: string) => {
  const user = userEvent.setup()
  if (current) await user.type(screen.getByLabelText('Текущий пароль'), current)
  if (next) await user.type(screen.getByLabelText('Новый пароль'), next)
  if (repeat) await user.type(screen.getByLabelText('Повторите новый пароль'), repeat)
  await user.click(screen.getByRole('button', { name: 'Сменить пароль' }))
}

describe('ChangePasswordForm', () => {
  it('показывает причину для нового пароля короче 8 символов и не отправляет запрос', async () => {
    render(<ChangePasswordForm />)
    await fill('old-password', 'short', 'short')

    expect(await screen.findByText('Пароль должен быть не короче 8 символов')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('показывает причину для нового пароля, совпадающего с текущим, и не отправляет запрос', async () => {
    render(<ChangePasswordForm />)
    await fill('same-password', 'same-password', 'same-password')

    expect(
      await screen.findByText('Новый пароль должен отличаться от текущего'),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('показывает причину при расхождении с повтором и не отправляет запрос', async () => {
    render(<ChangePasswordForm />)
    await fill('old-password', 'new-password', 'new-passw0rd')

    expect(await screen.findByText('Пароли не совпадают')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('отправляет PUT /api/profile/password и очищает поля после успеха', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { user: { id: '1' } }))
    render(<ChangePasswordForm />)
    await fill('old-password', 'new-password', 'new-password')

    expect(await screen.findByText('Пароль изменён')).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/profile/password')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toEqual({
      currentPassword: 'old-password',
      newPassword: 'new-password',
    })
    expect(screen.getByLabelText('Текущий пароль')).toHaveValue('')
    expect(screen.getByLabelText('Новый пароль')).toHaveValue('')
    expect(screen.getByLabelText('Повторите новый пароль')).toHaveValue('')
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('показывает ошибку API для неверного текущего пароля и не очищает поля', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { message: 'Неверный текущий пароль' }))
    render(<ChangePasswordForm />)
    await fill('wrong-password', 'new-password', 'new-password')

    expect(await screen.findByText('Неверный текущий пароль')).toBeInTheDocument()
    expect(screen.getByLabelText('Текущий пароль')).toHaveValue('wrong-password')
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('при 401 уводит на /login', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'Unauthorized' }))
    render(<ChangePasswordForm />)
    await fill('old-password', 'new-password', 'new-password')

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'))
  })
})
