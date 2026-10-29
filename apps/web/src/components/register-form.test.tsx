import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RegisterForm } from './register-form'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  push.mockClear()
  fetchMock.mockReset()
})

const fill = async (confirm: string) => {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/Имя/), 'Аня')
  await user.type(screen.getByLabelText(/Email/), 'a@b.co')
  await user.type(screen.getByLabelText(/^Пароль/), 'secret123')
  await user.type(screen.getByLabelText(/Подтвердите пароль/), confirm)
  await user.click(screen.getByRole('button', { name: 'Создать аккаунт' }))
}

describe('RegisterForm', () => {
  it('does not submit when passwords differ', async () => {
    render(<RegisterForm />)
    await fill('secret124')

    expect(await screen.findByText('Пароли не совпадают')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('registers and redirects when passwords match', async () => {
    fetchMock.mockResolvedValue(Response.json({ user: { id: '1', email: 'a@b.co', name: 'Аня' } }))
    render(<RegisterForm />)
    await fill('secret123')

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/'))
    expect(screen.getByLabelText(/Имя/)).toHaveValue('')
    expect(screen.getByLabelText(/^Пароль/)).toHaveValue('')
    expect(screen.getByLabelText(/Подтвердите пароль/)).toHaveValue('')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ name: 'Аня', email: 'a@b.co', password: 'secret123' })
  })
})
