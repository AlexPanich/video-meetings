import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MeetingSummary } from './meeting-summary'

const router = { replace: vi.fn() }
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const fetchMock = vi.fn()

// короткий интервал опроса: тесты идут на настоящих таймерах
const POLL = 20

const result = (overrides: Partial<Record<string, unknown>> = {}) => ({
  summary: 'Обсудили запуск релиза и распределили задачи.',
  decisions: ['Релиз в пятницу', 'Отказаться от старого API'],
  actionItems: [
    { task: 'Подготовить заметки к релизу', assignee: 'Анна', dueDate: '2026-11-20' },
    { task: 'Проверить миграции' },
  ],
  openQuestions: ['Кто дежурит в выходные?'],
  skippedFiles: [{ id: 'f9', name: 'запись.mp4' }],
  ...overrides,
})

const summary = (overrides: Partial<Record<string, unknown>> = {}) => ({
  meetingId: 'm1',
  status: 'done',
  result: result(),
  error: null,
  createdAt: '2026-11-16T10:00:00.000Z',
  updatedAt: '2026-11-16T10:05:00.000Z',
  ...overrides,
})

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

type Reply = { body: unknown; status?: number }

// Мок BFF: GET отдаёт ответы по очереди (последний повторяется), POST — свой ответ
const api = (
  gets: Reply[],
  post: Reply = { body: summary({ status: 'pending' }), status: 202 },
) => {
  let index = 0
  fetchMock.mockImplementation((_url: string, init: RequestInit = {}) => {
    if (init.method === 'POST') return Promise.resolve(jsonResponse(post.body, post.status ?? 202))
    const reply = gets[Math.min(index++, gets.length - 1)]
    return Promise.resolve(jsonResponse(reply.body, reply.status ?? 200))
  })
}

const notStarted: Reply = { body: { message: 'Саммари встречи ещё не запускали' }, status: 404 }

const postCalls = () =>
  fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')

const renderSummary = () => render(<MeetingSummary meetingId="m1" pollInterval={POLL} />)

const pause = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  router.replace.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MeetingSummary', () => {
  it('запрашивает саммари своей встречи через /api без кэша', async () => {
    api([notStarted])
    renderSummary()

    await screen.findByRole('button', { name: 'Сделать саммари' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/meetings/m1/summary',
      expect.objectContaining({ cache: 'no-store' }),
    )
  })

  it('пока статус грузится, показывает состояние загрузки', () => {
    fetchMock.mockReturnValue(new Promise(() => undefined))
    renderSummary()

    expect(screen.getByRole('status', { name: 'Загрузка саммари' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Сделать саммари' })).not.toBeInTheDocument()
  })

  it('без саммари (404) — кнопка «Сделать саммари» и нет «Пересоздать»', async () => {
    api([notStarted])
    renderSummary()

    const button = await screen.findByRole('button', { name: 'Сделать саммари' })
    expect(button).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Пересоздать саммари' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('при готовом саммари — кнопка «Пересоздать саммари» и статус «Готово»', async () => {
    api([{ body: summary() }])
    renderSummary()

    expect(await screen.findByRole('button', { name: 'Пересоздать саммари' })).toBeEnabled()
    expect(screen.getByText('Готово')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Сделать саммари' })).not.toBeInTheDocument()
  })

  it.each([
    ['pending', 'В очереди'],
    ['transcribing', 'Транскрибация'],
    ['generating', 'Генерация'],
    ['done', 'Готово'],
    ['failed', 'Ошибка'],
  ])('статус %s показывается как «%s»', async (status, label) => {
    api([{ body: summary({ status, result: null, error: status === 'failed' ? 'Сбой' : null }) }])
    renderSummary()

    expect(await screen.findByText(label)).toBeInTheDocument()
  })

  it('запуск: POST на /api, статусы обновляются без перезагрузки до «Готово»', async () => {
    api([
      notStarted,
      { body: summary({ status: 'pending', result: null }) },
      { body: summary({ status: 'transcribing', result: null }) },
      { body: summary({ status: 'generating', result: null }) },
      { body: summary() },
    ])
    renderSummary()

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Сделать саммари' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/meetings/m1/summary',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(await screen.findByText('В очереди')).toBeInTheDocument()
    expect(await screen.findByText('Транскрибация')).toBeInTheDocument()
    expect(await screen.findByText('Генерация')).toBeInTheDocument()
    expect(await screen.findByText('Готово')).toBeInTheDocument()
    expect(await screen.findByText(result().summary)).toBeInTheDocument()
    expect(postCalls()).toHaveLength(1)
  })

  it('пока задача активна, кнопки запуска недоступны', async () => {
    api([{ body: summary({ status: 'generating' }) }])
    renderSummary()

    await screen.findByText('Генерация')
    expect(screen.getByRole('button', { name: 'Пересоздать саммари' })).toBeDisabled()
  })

  it('пока задача в очереди без результата, «Сделать саммари» недоступна', async () => {
    api([{ body: summary({ status: 'pending', result: null }) }])
    renderSummary()

    await screen.findByText('В очереди')
    expect(screen.getByRole('button', { name: 'Сделать саммари' })).toBeDisabled()
  })

  it('после «Готово» опрос останавливается', async () => {
    api([{ body: summary({ status: 'generating', result: null }) }, { body: summary() }])
    renderSummary()

    await screen.findByText('Готово')
    const calls = fetchMock.mock.calls.length
    await pause(POLL * 5)
    expect(fetchMock.mock.calls.length).toBe(calls)
  })

  it('при ошибке задачи опрос тоже останавливается', async () => {
    api([
      { body: summary({ status: 'generating', result: null }) },
      { body: summary({ status: 'failed', result: null, error: 'Ollama недоступна' }) },
    ])
    renderSummary()

    await screen.findByText('Ollama недоступна')
    const calls = fetchMock.mock.calls.length
    await pause(POLL * 5)
    expect(fetchMock.mock.calls.length).toBe(calls)
  })

  it('после размонтирования опрос не продолжается', async () => {
    api([{ body: summary({ status: 'generating', result: null }) }])
    const { unmount } = renderSummary()

    await screen.findByText('Генерация')
    unmount()
    const calls = fetchMock.mock.calls.length
    await pause(POLL * 5)
    expect(fetchMock.mock.calls.length).toBe(calls)
  })

  it('временный сбой опроса не обрывает его: статус дойдёт до «Готово»', async () => {
    api([
      { body: summary({ status: 'generating', result: null }) },
      { body: { message: 'Bad Gateway' }, status: 502 },
      { body: summary() },
    ])
    renderSummary()

    expect(await screen.findByText('Готово')).toBeInTheDocument()
  })

  it('после нескольких сбоев опроса подряд он останавливается, «Обновить» запускает снова', async () => {
    api([
      { body: summary({ status: 'generating', result: null }) },
      { body: { message: 'Bad Gateway' }, status: 502 },
      { body: { message: 'Bad Gateway' }, status: 502 },
      { body: { message: 'Bad Gateway' }, status: 502 },
      { body: { message: 'Bad Gateway' }, status: 502 },
      { body: { message: 'Bad Gateway' }, status: 502 },
      { body: summary() },
    ])
    renderSummary()

    const refresh = await screen.findByRole('button', { name: 'Обновить' })
    expect(screen.getByText('Не удалось обновить статус саммари')).toBeInTheDocument()
    const calls = fetchMock.mock.calls.length
    await pause(POLL * 5)
    expect(fetchMock.mock.calls.length).toBe(calls)

    await userEvent.setup().click(refresh)
    expect(await screen.findByText('Готово')).toBeInTheDocument()
    expect(screen.queryByText('Не удалось обновить статус саммари')).not.toBeInTheDocument()
  })

  it('в скрытой вкладке опрос на паузе и продолжается, когда её открывают', async () => {
    let visibility: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    api([{ body: summary({ status: 'generating', result: null }) }, { body: summary() }])
    renderSummary()

    await screen.findByText('Генерация')
    visibility = 'hidden'
    const calls = fetchMock.mock.calls.length
    await pause(POLL * 5)
    expect(fetchMock.mock.calls.length).toBe(calls)

    visibility = 'visible'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(await screen.findByText('Готово')).toBeInTheDocument()
    vi.restoreAllMocks()
  })

  it('при failed — одна кнопка запуска: «Повторить» у причины', async () => {
    api([{ body: summary({ status: 'failed', error: 'Сбой' }) }])
    renderSummary()

    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: 'Пересоздать саммари' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('блок саммари: резюме, решения, задачи (что, кто, срок), открытые вопросы, неучтённые файлы', async () => {
    api([{ body: summary() }])
    renderSummary()

    const summarySection = await screen.findByRole('region', { name: 'Резюме' })
    expect(summarySection).toHaveTextContent(result().summary)

    const decisions = within(screen.getByRole('region', { name: 'Решения' })).getAllByRole(
      'listitem',
    )
    expect(decisions.map((item) => item.textContent)).toEqual([
      'Релиз в пятницу',
      'Отказаться от старого API',
    ])

    const tasks = within(screen.getByRole('region', { name: 'Задачи' })).getAllByRole('listitem')
    expect(tasks).toHaveLength(2)
    expect(tasks[0]).toHaveTextContent('Подготовить заметки к релизу')
    expect(tasks[0]).toHaveTextContent('Анна')
    expect(tasks[0]).toHaveTextContent('2026-11-20')
    expect(tasks[1]).toHaveTextContent('Проверить миграции')

    const questions = within(screen.getByRole('region', { name: 'Открытые вопросы' }))
    expect(questions.getByText('Кто дежурит в выходные?')).toBeInTheDocument()

    const skipped = within(screen.getByRole('region', { name: 'Неучтённые файлы' }))
    expect(skipped.getByText('запись.mp4')).toBeInTheDocument()
  })

  it('пустые разделы помечены, а раздел неучтённых файлов без файлов скрыт', async () => {
    api([
      {
        body: summary({
          result: result({ decisions: [], actionItems: [], openQuestions: [], skippedFiles: [] }),
        }),
      },
    ])
    renderSummary()

    const decisions = await screen.findByRole('region', { name: 'Решения' })
    expect(within(decisions).queryByRole('listitem')).not.toBeInTheDocument()
    expect(decisions).toHaveTextContent('Нет')
    expect(screen.getByRole('region', { name: 'Задачи' })).toHaveTextContent('Нет')
    expect(screen.getByRole('region', { name: 'Открытые вопросы' })).toHaveTextContent('Нет')
    expect(screen.queryByRole('region', { name: 'Неучтённые файлы' })).not.toBeInTheDocument()
  })

  it('при пересоздании прежнее саммари остаётся видно, пока идёт новая задача', async () => {
    api([{ body: summary({ status: 'generating' }) }])
    renderSummary()

    await screen.findByText('Генерация')
    expect(screen.getByRole('region', { name: 'Резюме' })).toHaveTextContent(result().summary)
    expect(screen.getByText('Показано предыдущее саммари')).toBeInTheDocument()
  })

  it('упавшее пересоздание помечает показанное саммари как предыдущее', async () => {
    api([{ body: summary({ status: 'failed', error: 'Ollama недоступна' }) }])
    renderSummary()

    await screen.findByText('Ollama недоступна')
    expect(screen.getByText('Показано предыдущее саммари')).toBeInTheDocument()
  })

  it('у готового саммари нет пометки «предыдущее»', async () => {
    api([{ body: summary() }])
    renderSummary()

    await screen.findByText('Готово')
    expect(screen.queryByText('Показано предыдущее саммари')).not.toBeInTheDocument()
  })

  it('статус в live-регионе: скринридер услышит смену', async () => {
    api([{ body: summary({ status: 'generating', result: null }) }, { body: summary() }])
    renderSummary()

    const live = await screen.findByText('Генерация')
    const region = live.closest('[role="status"]')
    expect(region).toHaveAttribute('aria-live', 'polite')
    await waitFor(() => expect(region).toHaveTextContent('Готово'))
  })

  it('неизвестный статус считается активным: опрос идёт, запуск недоступен', async () => {
    api([{ body: summary({ status: 'archiving', result: null }) }, { body: summary() }])
    renderSummary()

    expect(await screen.findByText('Обрабатывается')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сделать саммари' })).toBeDisabled()
    expect(await screen.findByText('Готово')).toBeInTheDocument()
  })

  it('пересоздание: «Пересоздать саммари» отправляет POST и запускает опрос', async () => {
    api([
      { body: summary() },
      { body: summary({ status: 'generating' }) },
      { body: summary({ result: result({ summary: 'Новое резюме' }) }) },
    ])
    renderSummary()

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Пересоздать саммари' }))

    expect(await screen.findByText('Новое резюме')).toBeInTheDocument()
    expect(postCalls()).toHaveLength(1)
  })

  it('при failed виден текст ошибки и работает повтор', async () => {
    api([
      { body: summary({ status: 'failed', result: null, error: 'Ollama недоступна' }) },
      { body: summary({ status: 'generating', result: null }) },
      { body: summary() },
    ])
    renderSummary()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Ollama недоступна')

    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Повторить' }))

    expect(await screen.findByText('Готово')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(postCalls()).toHaveLength(1)
  })

  it('failed без причины — общий текст ошибки', async () => {
    api([{ body: summary({ status: 'failed', result: null, error: null }) }])
    renderSummary()

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось сделать саммари')
  })

  it('409: вторая задача не создаётся, показывается статус уже идущей', async () => {
    api([notStarted, { body: summary({ status: 'generating', result: null }) }], {
      body: { message: 'Саммари уже генерируется' },
      status: 409,
    })
    renderSummary()

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Сделать саммари' }))

    expect(await screen.findByText('Генерация')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сделать саммари' })).toBeDisabled()
    await pause(POLL * 3)
    expect(postCalls()).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('повторный клик во время запроса не отправляет второй POST', async () => {
    let resolvePost: (response: Response) => void = () => undefined
    fetchMock.mockImplementation((_url: string, init: RequestInit = {}) =>
      init.method === 'POST'
        ? new Promise<Response>((resolve) => (resolvePost = resolve))
        : Promise.resolve(jsonResponse(notStarted.body, 404)),
    )
    renderSummary()

    const user = userEvent.setup()
    const button = await screen.findByRole('button', { name: 'Сделать саммари' })
    await user.click(button)
    await user.click(button)

    expect(postCalls()).toHaveLength(1)
    resolvePost(jsonResponse(summary({ status: 'pending', result: null }), 202))
    expect(await screen.findByText('В очереди')).toBeInTheDocument()
  })

  it('ошибка запуска (429) показывается, кнопка снова доступна', async () => {
    api([notStarted], { body: { message: 'Слишком много запросов' }, status: 429 })
    renderSummary()

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Сделать саммари' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Слишком много запросов')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Сделать саммари' })).toBeEnabled(),
    )
  })

  it('ошибка загрузки статуса — сообщение и повтор', async () => {
    api([{ body: { message: 'Ошибка' }, status: 500 }, { body: summary() }])
    renderSummary()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Не удалось загрузить саммари')

    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Повторить' }))

    expect(await screen.findByText('Готово')).toBeInTheDocument()
    expect(postCalls()).toHaveLength(0)
  })

  it('401 при загрузке уводит на вход', async () => {
    api([{ body: { message: 'Unauthorized' }, status: 401 }])
    renderSummary()

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'))
  })

  it('401 при запуске уводит на вход', async () => {
    api([notStarted], { body: { message: 'Unauthorized' }, status: 401 })
    renderSummary()

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Сделать саммари' }))

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'))
  })
})
