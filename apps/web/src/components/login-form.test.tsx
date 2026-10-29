import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginForm } from './login-form'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  localStorage.clear()
  push.mockClear()
  fetchMock.mockReset()
})

const fillAndSubmit = async () => {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email'), 'a@b.co')
  await user.type(screen.getByLabelText('Пароль'), 'secret123')
  await user.click(screen.getByRole('button', { name: 'Войти' }))
}

describe('LoginForm', () => {
  it('stores the token and redirects on success', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ accessToken: 'jwt', user: { id: '1', email: 'a@b.co', name: 'A' } }),
    )
    render(<LoginForm />)
    await fillAndSubmit()

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/'))
    expect(localStorage.getItem('access-token')).toBe('jwt')
    expect(screen.getByLabelText('Email')).toHaveValue('')
    expect(screen.getByLabelText('Пароль')).toHaveValue('')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('shows the server error', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ message: 'Неверный email или пароль' }, { status: 401 }),
    )
    render(<LoginForm />)
    await fillAndSubmit()

    expect(await screen.findByText('Неверный email или пароль')).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })
})
