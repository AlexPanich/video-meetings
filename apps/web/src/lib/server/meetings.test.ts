// @vitest-environment node
import { getMeeting } from './meetings'

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: 'jwt' }) }),
}))

const fetchMock = vi.fn()
const meeting = { id: 'm1', title: 'Планёрка', date: '2030-01-01T00:00:00.000Z', participants: [] }

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getMeeting', () => {
  it('возвращает встречу', async () => {
    fetchMock.mockResolvedValue(Response.json(meeting))

    expect(await getMeeting('m1')).toEqual({ ok: true, data: meeting })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/meetings/m1',
      expect.objectContaining({ headers: { Authorization: 'Bearer jwt' } }),
    )
  })

  it.each([401, 404, 500])('сохраняет статус отказа API: %i', async (status) => {
    fetchMock.mockResolvedValue(Response.json({ message: 'x' }, { status }))

    expect(await getMeeting('m2' + status)).toEqual({ ok: false, status })
  })

  it('сеть недоступна — status 0, а не «не найдено»', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    expect(await getMeeting('net')).toEqual({ ok: false, status: 0 })
  })

  it.each(['.', '..', 'a/b', '%2e', ''])('небезопасный id "%s" в API не уходит', async (id) => {
    expect(await getMeeting(id)).toEqual({ ok: false, status: 404 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ответ другой формы (список вместо встречи) — 404', async () => {
    fetchMock.mockResolvedValue(Response.json([meeting]))

    expect(await getMeeting('shape')).toEqual({ ok: false, status: 404 })
  })
})
