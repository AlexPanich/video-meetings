import { ApiError, createMeeting, getMeetingSummary, startMeetingSummary } from './api'

const fetchMock = vi.fn()

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const summary = {
  meetingId: 'm/1',
  status: 'pending',
  result: null,
  error: null,
  createdAt: '2026-11-16T10:00:00.000Z',
  updatedAt: '2026-11-16T10:00:00.000Z',
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('саммари встречи', () => {
  it('getMeetingSummary: GET через BFF без кэша, id экранируется', async () => {
    fetchMock.mockResolvedValue(jsonResponse(summary))

    await expect(getMeetingSummary('m/1')).resolves.toEqual(summary)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/meetings/m%2F1/summary',
      expect.objectContaining({ cache: 'no-store' }),
    )
  })

  it('getMeetingSummary: саммари ещё не запускали (404) — null, а не ошибка', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Саммари встречи ещё не запускали' }, 404))

    await expect(getMeetingSummary('m1')).resolves.toBeNull()
  })

  it('getMeetingSummary: прочие ошибки — ApiError со статусом', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Ошибка' }, 500))

    await expect(getMeetingSummary('m1')).rejects.toMatchObject({ status: 500 })
    await expect(getMeetingSummary('m1')).rejects.toBeInstanceOf(ApiError)
  })

  it('startMeetingSummary: POST через BFF, возвращает задачу', async () => {
    fetchMock.mockResolvedValue(jsonResponse(summary, 202))

    await expect(startMeetingSummary('m1')).resolves.toEqual(summary)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/meetings/m1/summary',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('startMeetingSummary: 409 — ApiError со статусом 409 и текстом API', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Саммари уже генерируется' }, 409))

    await expect(startMeetingSummary('m1')).rejects.toMatchObject({
      status: 409,
      message: 'Саммари уже генерируется',
    })
  })
})

describe('создание встречи', () => {
  const meeting = {
    id: 'm1',
    title: 'Планёрка',
    date: '2030-01-15T10:00:00.000Z',
    participants: [],
    ownerId: 'u1',
  }

  it('createMeeting: POST /api/meetings с JSON-телом, возвращает встречу', async () => {
    fetchMock.mockResolvedValue(jsonResponse(meeting, 201))
    const input = { title: 'Планёрка', date: '2030-01-15T10:00:00.000Z', participants: [] }

    await expect(createMeeting(input)).resolves.toEqual(meeting)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/meetings')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual(input)
  })

  it('createMeeting: 400 — ApiError с причиной из API', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ message: ['Название не может быть пустым'], statusCode: 400 }, 400),
    )

    await expect(
      createMeeting({ title: ' ', date: '2030-01-15T10:00:00.000Z', participants: [] }),
    ).rejects.toMatchObject({ status: 400, message: 'Название не может быть пустым' })
  })
})
