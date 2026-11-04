import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Activity } from 'react'
import { ChangePasswordForm } from './change-password-form'

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const fetchMock = vi.fn()
const EMAIL = 'ivan@example.com'

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
    render(<ChangePasswordForm email={EMAIL} />)
    await fill('old-password', 'short', 'short')

    expect(await screen.findByText('Пароль должен быть не короче 8 символов')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('показывает причину для нового пароля, совпадающего с текущим, и не отправляет запрос', async () => {
    render(<ChangePasswordForm email={EMAIL} />)
    await fill('same-password', 'same-password', 'same-password')

    expect(
      await screen.findByText('Новый пароль должен отличаться от текущего'),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('показывает причину при расхождении с повтором и не отправляет запрос', async () => {
    render(<ChangePasswordForm email={EMAIL} />)
    await fill('old-password', 'new-password', 'new-passw0rd')

    expect(await screen.findByText('Пароли не совпадают')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('отправляет PUT /api/profile/password и очищает поля после успеха', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { user: { id: '1' } }))
    render(<ChangePasswordForm email={EMAIL} />)
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
    render(<ChangePasswordForm email={EMAIL} />)
    await fill('wrong-password', 'new-password', 'new-password')

    expect(await screen.findByText('Неверный текущий пароль')).toBeInTheDocument()
    expect(screen.getByLabelText('Текущий пароль')).toHaveValue('wrong-password')
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('при 401 уводит на /login', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'Unauthorized' }))
    render(<ChangePasswordForm email={EMAIL} />)
    await fill('old-password', 'new-password', 'new-password')

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'))
  })

  it('считает длину по символам: пароль из 4 эмодзи слишком короткий', async () => {
    render(<ChangePasswordForm email={EMAIL} />)
    await fill('old-password', '😀😀😀😀', '😀😀😀😀')

    expect(await screen.findByText('Пароль должен быть не короче 8 символов')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('не отправляет запрос с новым паролем длиннее 128 символов', async () => {
    render(<ChangePasswordForm email={EMAIL} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Текущий пароль'), 'old-password')
    const long = 'a'.repeat(129)
    await user.click(screen.getByLabelText('Новый пароль'))
    await user.paste(long)
    await user.click(screen.getByLabelText('Повторите новый пароль'))
    await user.paste(long)
    await user.click(screen.getByRole('button', { name: 'Сменить пароль' }))

    expect(
      await screen.findByText('Пароль должен быть не длиннее 128 символов'),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('после успеха не оставляет ошибку поля, показанную до исправления', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { user: { id: '1' } }))
    render(<ChangePasswordForm email={EMAIL} />)
    await fill('old-password', 'new-password', 'new-passwordX')
    expect(await screen.findByText('Пароли не совпадают')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.clear(screen.getByLabelText('Новый пароль'))
    await user.type(screen.getByLabelText('Новый пароль'), 'new-passwordX')
    await user.click(screen.getByRole('button', { name: 'Сменить пароль' }))

    expect(await screen.findByText('Пароль изменён')).toBeInTheDocument()
    expect(screen.queryByText('Пароли не совпадают')).not.toBeInTheDocument()
  })

  it('показывает ошибку сети и не очищает поля', async () => {
    fetchMock.mockRejectedValue(new Error('network'))
    render(<ChangePasswordForm email={EMAIL} />)
    await fill('old-password', 'new-password', 'new-password')

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByLabelText('Текущий пароль')).toHaveValue('old-password')
  })

  it('показывает причину при 409 и не уводит на /login', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, { message: 'Пароль уже был изменён другим запросом' }),
    )
    render(<ChangePasswordForm email={EMAIL} />)
    await fill('old-password', 'new-password', 'new-password')

    expect(await screen.findByText('Пароль уже был изменён другим запросом')).toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('объявляет ошибку API через role="alert", а успех через role="status"', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { message: 'Неверный текущий пароль' }))
    render(<ChangePasswordForm email={EMAIL} />)
    await fill('wrong-password', 'new-password', 'new-password')
    expect(await screen.findByRole('alert')).toHaveTextContent('Неверный текущий пароль')

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: { id: '1' } }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Сменить пароль' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Пароль изменён')
  })

  it('не отправляет пароли в URL до гидратации: форма с method="post"', () => {
    const { container } = render(<ChangePasswordForm email={EMAIL} />)

    expect(container.querySelector('form')).toHaveAttribute('method', 'post')
  })

  it('отдаёт менеджеру паролей аккаунт скрытым полем username без name', () => {
    const { container } = render(<ChangePasswordForm email={EMAIL} />)

    const username = container.querySelector('input[autocomplete="username"]')
    expect(username).toHaveValue(EMAIL)
    expect(username).not.toHaveAttribute('name')
  })

  describe('при скрытии страницы (Activity)', () => {
    const renderActivity = (mode: 'visible' | 'hidden') => (
      <Activity mode={mode}>
        <ChangePasswordForm email={EMAIL} />
      </Activity>
    )

    it('сбрасывает поля, ошибку поля и режим показа пароля', async () => {
      const { rerender } = render(renderActivity('visible'))
      await fill('old-password', 'short', 'short')
      expect(await screen.findByText('Пароль должен быть не короче 8 символов')).toBeInTheDocument()
      await userEvent.setup().click(screen.getAllByRole('button', { name: 'Показать пароль' })[0])

      rerender(renderActivity('hidden'))
      rerender(renderActivity('visible'))

      expect(screen.getByLabelText('Новый пароль')).toHaveValue('')
      expect(screen.queryByText('Пароль должен быть не короче 8 символов')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Скрыть пароль' })).not.toBeInTheDocument()
    })

    it('не показывает результат запроса, завершившегося на скрытой странице', async () => {
      let resolve!: (response: Response) => void
      fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)))
      const { rerender } = render(renderActivity('visible'))
      await fill('wrong-password', 'new-password', 'new-password')

      rerender(renderActivity('hidden'))
      resolve(jsonResponse(403, { message: 'Неверный текущий пароль' }))
      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      await new Promise((r) => setTimeout(r, 0))
      rerender(renderActivity('visible'))

      expect(screen.queryByText('Неверный текущий пароль')).not.toBeInTheDocument()
    })
  })
})
