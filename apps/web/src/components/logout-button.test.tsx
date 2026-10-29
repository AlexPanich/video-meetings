import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LogoutButton } from './logout-button'

const router = { replace: vi.fn() }
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  router.replace.mockClear()
  fetchMock.mockReset()
})

describe('LogoutButton', () => {
  it('calls logout and redirects to /login', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    render(<LogoutButton />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Выйти' }))

    await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
