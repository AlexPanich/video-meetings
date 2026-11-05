// @vitest-environment node
import { NextRequest } from 'next/server'
import { POST } from './route'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const post = (cookie = 'access-token=some-token') =>
  POST(new NextRequest('http://localhost/api/auth/logout', { method: 'POST', headers: { cookie } }))

describe('POST /api/auth/logout', () => {
  it('отзывает токены в API и сбрасывает cookie', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    const response = await post()

    expect(response.status).toBe(204)
    expect(response.headers.get('set-cookie') ?? '').toMatch(/access-token=;/)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3001/auth/logout')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer some-token')
  })

  it('сбрасывает cookie, даже если API недоступен', async () => {
    fetchMock.mockRejectedValue(new Error('down'))

    const response = await post()

    expect(response.status).toBe(204)
    expect(response.headers.get('set-cookie') ?? '').toMatch(/access-token=;/)
  })

  it('без cookie не обращается к API', async () => {
    const response = await post('')

    expect(response.status).toBe(204)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
