// @vitest-environment node
import { NextRequest } from 'next/server'
import { PUT } from './route'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const put = (body: unknown, cookie = 'access-token=old-token') =>
  PUT(
    new NextRequest('http://localhost/api/profile/password', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

const passwords = { currentPassword: 'old-password', newPassword: 'new-password' }
const user = { id: '1', email: 'ivan@example.com', name: 'Иван' }

describe('PUT /api/profile/password', () => {
  it('кладёт новый токен в HttpOnly-cookie и не отдаёт его браузеру', async () => {
    fetchMock.mockResolvedValue(Response.json({ accessToken: 'new-token', user }))

    const response = await put(passwords)

    expect(response.status).toBe(200)
    const setCookie = response.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('access-token=new-token')
    expect(setCookie).toContain('HttpOnly')
    const text = await response.text()
    expect(text).not.toContain('new-token')
    expect(JSON.parse(text)).toEqual({ user })
  })

  it('отправляет в API PUT /profile/password с токеном из cookie', async () => {
    fetchMock.mockResolvedValue(Response.json({ accessToken: 'new-token', user }))

    await put(passwords)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3001/profile/password')
    expect(init.method).toBe('PUT')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer old-token')
    // тело уходит потоком, а не буферизуется в память
    expect(init.body).toBeInstanceOf(ReadableStream)
    expect(await new Response(init.body as ReadableStream).json()).toEqual(passwords)
  })

  it.each([
    [403, { message: 'Неверный текущий пароль' }],
    [400, { message: ['newPassword must be longer'] }],
    [409, { message: 'Пароль уже был изменён другим запросом' }],
  ])('при %i отдаёт ошибку API как есть и не трогает cookie', async (status, body) => {
    fetchMock.mockResolvedValue(Response.json(body, { status }))

    const response = await put(passwords)

    expect(response.status).toBe(status)
    expect(await response.json()).toEqual(body)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('при 401 сбрасывает cookie', async () => {
    fetchMock.mockResolvedValue(Response.json({ message: 'Unauthorized' }, { status: 401 }))

    const response = await put(passwords)

    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie') ?? '').toMatch(/access-token=;/)
  })

  it('без cookie отвечает 401 и не обращается к API', async () => {
    const response = await put(passwords, '')

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('при недоступном API отвечает 502', async () => {
    fetchMock.mockRejectedValue(new Error('down'))

    const response = await put(passwords)

    expect(response.status).toBe(502)
  })

  it('429: передаёт Retry-After и добавляет ожидание в сообщение', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { message: 'Слишком много попыток, повторите позже' },
        { status: 429, headers: { 'Retry-After': '42' } },
      ),
    )

    const response = await put(passwords)

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('42')
    expect(await response.json()).toEqual({
      message: 'Слишком много попыток, повторите позже. Подождите 42 с',
    })
  })

  it('передаёт IP клиента из доверенного X-Forwarded-For', async () => {
    vi.stubEnv('TRUSTED_PROXIES', '1')
    fetchMock.mockResolvedValue(Response.json({ accessToken: 't', user }))

    await PUT(
      new NextRequest('http://localhost/api/profile/password', {
        method: 'PUT',
        headers: {
          cookie: 'access-token=old',
          'content-type': 'application/json',
          'x-forwarded-for': '6.6.6.6, 203.0.113.7',
        },
        body: JSON.stringify(passwords),
      }),
    )

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new Headers(init.headers).get('x-forwarded-for')).toBe('203.0.113.7')
    vi.unstubAllEnvs()
  })
})
