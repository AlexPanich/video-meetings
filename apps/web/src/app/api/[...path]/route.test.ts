// @vitest-environment node
import { NextRequest } from 'next/server'
import { DELETE, GET, POST } from './route'

const fetchMock = vi.fn()
const ctx = (...path: string[]) => ({ params: Promise.resolve({ path }) })
const withToken = { cookie: 'access-token=jwt-token' }

const streamOf = (...chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      controller.close()
    },
  })

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const lastCall = () => fetchMock.mock.calls[0] as [string, RequestInit & { duplex?: string }]

describe('прокси /api/*', () => {
  it('загрузка: тело уходит в API потоком, без буферизации в память', async () => {
    fetchMock.mockResolvedValue(Response.json({ id: 'f1' }, { status: 201 }))
    const request = new NextRequest('http://localhost/api/meetings/m1/files', {
      method: 'POST',
      headers: {
        ...withToken,
        'content-type': 'multipart/form-data; boundary=xyz',
        'content-length': '12',
      },
      body: streamOf('--xyz', 'data'),
      duplex: 'half',
    } as ConstructorParameters<typeof NextRequest>[1])
    const arrayBuffer = vi.spyOn(request, 'arrayBuffer')

    const response = await POST(request, ctx('meetings', 'm1', 'files'))

    expect(response.status).toBe(201)
    const [url, init] = lastCall()
    expect(url).toBe('http://localhost:3001/meetings/m1/files')
    expect(init.body).toBeInstanceOf(ReadableStream)
    expect(init.duplex).toBe('half')
    expect(arrayBuffer).not.toHaveBeenCalled()
    const headers = new Headers(init.headers)
    expect(headers.get('authorization')).toBe('Bearer jwt-token')
    expect(headers.get('content-type')).toBe('multipart/form-data; boundary=xyz')
    // API отсекает слишком большой файл по Content-Length ещё до чтения тела
    expect(headers.get('content-length')).toBe('12')
    // и тело действительно доходит целиком
    const sent = await new Response(init.body as ReadableStream).text()
    expect(sent).toBe('--xyzdata')
  })

  it('скачивание: пробрасывает Content-Disposition, nosniff, Content-Length и тип', async () => {
    fetchMock.mockResolvedValue(
      new Response('содержимое', {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="a.pdf"; filename*=UTF-8''%D0%BE.pdf`,
          'Content-Length': '20',
          'X-Content-Type-Options': 'nosniff',
        },
      }),
    )
    const request = new NextRequest('http://localhost/api/meetings/m1/files/f1/download', {
      headers: withToken,
    })

    const response = await GET(request, ctx('meetings', 'm1', 'files', 'f1', 'download'))

    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="a.pdf"; filename*=UTF-8''%D0%BE.pdf`,
    )
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-length')).toBe('20')
    expect(await response.text()).toBe('содержимое')
  })

  it('удаление: DELETE доходит до API без тела', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    const request = new NextRequest('http://localhost/api/meetings/m1/files/f1', {
      method: 'DELETE',
      headers: withToken,
    })

    const response = await DELETE(request, ctx('meetings', 'm1', 'files', 'f1'))

    expect(response.status).toBe(204)
    const [, init] = lastCall()
    expect(init.method).toBe('DELETE')
    expect(init.body).toBeUndefined()
  })

  it('пустое тело (DELETE/POST без данных) не ломает прокси', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })))
    const empty = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close()
        },
      })

    for (const method of ['DELETE', 'POST']) {
      const request = new NextRequest('http://localhost/api/meetings/m1/files/f1', {
        method,
        headers: withToken,
        body: empty(),
        duplex: 'half',
      } as ConstructorParameters<typeof NextRequest>[1])

      const handler = method === 'DELETE' ? DELETE : POST
      const response = await handler(request, ctx('meetings', 'm1', 'files', 'f1'))

      expect(response.status).toBe(204)
    }
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('401 от API сбрасывает cookie', async () => {
    fetchMock.mockResolvedValue(Response.json({ message: 'Unauthorized' }, { status: 401 }))
    const request = new NextRequest('http://localhost/api/meetings', { headers: withToken })

    const response = await GET(request, ctx('meetings'))

    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toMatch(/access-token=;/)
  })

  it('502, если API недоступен', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    const request = new NextRequest('http://localhost/api/meetings', { headers: withToken })

    const response = await GET(request, ctx('meetings'))

    expect(response.status).toBe(502)
  })
})
