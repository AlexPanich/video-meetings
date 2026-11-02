import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MeetingFiles } from './meeting-files'

const fetchMock = vi.fn()

const file = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'f1',
  meetingId: 'm1',
  name: 'Протокол встречи.pdf',
  size: 1536,
  mimeType: 'application/pdf',
  status: 'uploaded',
  createdAt: '2026-11-03T12:00:00.000Z',
  ...overrides,
})

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

describe('MeetingFiles', () => {
  it('запрашивает файлы своей встречи через /api', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    render(<MeetingFiles meetingId="m1" />)

    await screen.findByText('Файлов пока нет')
    expect(fetchMock).toHaveBeenCalledWith('/api/meetings/m1/files', expect.anything())
  })

  it('показывает имя, размер, дату и статус каждого файла', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        file(),
        file({ id: 'f2', name: 'запись.mp4', size: 5 * 1024 * 1024, status: 'uploading' }),
        file({ id: 'f3', name: 'битый.zip', size: 10, status: 'failed' }),
      ]),
    )
    render(<MeetingFiles meetingId="m1" />)

    const items = await screen.findAllByRole('listitem')
    expect(items).toHaveLength(3)

    const first = within(items[0])
    expect(first.getByText('Протокол встречи.pdf')).toBeInTheDocument()
    expect(first.getByText('1,5 КБ')).toBeInTheDocument()
    expect(first.getByText(/нояб\. 2026/)).toBeInTheDocument()
    expect(first.getByText('Загружен')).toBeInTheDocument()

    expect(within(items[1]).getByText('5 МБ')).toBeInTheDocument()
    expect(within(items[1]).getByText('Загружается')).toBeInTheDocument()
    expect(within(items[2]).getByText('Ошибка')).toBeInTheDocument()
  })

  it('пока файлы грузятся, показывает состояние загрузки', async () => {
    fetchMock.mockReturnValue(new Promise(() => undefined))
    render(<MeetingFiles meetingId="m1" />)

    expect(screen.getByRole('status', { name: 'Загрузка файлов' })).toBeInTheDocument()
    expect(screen.queryByText('Файлов пока нет')).not.toBeInTheDocument()
  })

  it('для встречи без файлов показывает пустой список', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    render(<MeetingFiles meetingId="m1" />)

    expect(await screen.findByText('Файлов пока нет')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Загрузка файлов' })).not.toBeInTheDocument()
  })

  it('при ошибке сервера показывает сообщение и позволяет повторить', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Ошибка' }, 500))
    render(<MeetingFiles meetingId="m1" />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Не удалось загрузить файлы')

    fetchMock.mockResolvedValueOnce(jsonResponse([file()]))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Повторить' }))

    expect(await screen.findByText('Протокол встречи.pdf')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('при обрыве сети тоже показывает ошибку', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<MeetingFiles meetingId="m1" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить файлы')
  })
})
