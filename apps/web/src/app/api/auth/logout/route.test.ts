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
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockRejectedValue(new Error('down'))

    const response = await post()

    expect(response.status).toBe(204)
    expect(response.headers.get('set-cookie') ?? '').toMatch(/access-token=;/)
  })

  it('логирует ответ API 5xx, но всё равно выходит локально', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }))

    const response = await post()

    expect(response.status).toBe(204)
    expect(response.headers.get('set-cookie') ?? '').toMatch(/access-token=;/)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('500'))
    error.mockRestore()
  })

  it('401 от API не считается сбоем и не логируется', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }))

    await post()

    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it('передаёт в fetch таймаут и логирует сетевую ошибку', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockRejectedValue(new Error('timeout'))

    await post()

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('без cookie не обращается к API', async () => {
    const response = await post('')

    expect(response.status).toBe(204)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
