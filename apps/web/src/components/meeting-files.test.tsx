import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { uploadFile } from '@/lib/upload'
import { MeetingFiles } from './meeting-files'

const router = { replace: vi.fn() }
vi.mock('next/navigation', () => ({ useRouter: () => router }))

vi.mock('@/lib/upload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/upload')>()),
  uploadFile: vi.fn(() => Promise.resolve()),
}))

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

// каждый вызов fetch получает свежий Response: тело читается один раз
const respond =
  (body: unknown, status = 200) =>
  () =>
    Promise.resolve(jsonResponse(body, status))

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  router.replace.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MeetingFiles', () => {
  it('запрашивает файлы своей встречи через /api', async () => {
    fetchMock.mockImplementation(respond([]))
    render(<MeetingFiles meetingId="m1" />)

    await screen.findByText('Файлов пока нет')
    expect(fetchMock).toHaveBeenCalledWith('/api/meetings/m1/files', expect.anything())
  })

  it('показывает имя, размер, дату и статус каждого файла', async () => {
    fetchMock.mockImplementation(
      respond([
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
    fetchMock.mockImplementation(respond([]))
    render(<MeetingFiles meetingId="m1" />)

    expect(await screen.findByText('Файлов пока нет')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Загрузка файлов' })).not.toBeInTheDocument()
  })

  it('при ошибке сервера показывает сообщение и позволяет повторить', async () => {
    fetchMock.mockImplementationOnce(respond({ message: 'Ошибка' }, 500))
    render(<MeetingFiles meetingId="m1" />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Не удалось загрузить файлы')

    fetchMock.mockImplementationOnce(respond([file()]))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Повторить' }))

    expect(await screen.findByText('Протокол встречи.pdf')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('при обрыве сети тоже показывает ошибку', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<MeetingFiles meetingId="m1" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить файлы')
  })

  it('401 (токен отклонён): уводит на вход, а не предлагает бесполезный повтор', async () => {
    fetchMock.mockImplementation(respond({ message: 'Unauthorized' }, 401))
    render(<MeetingFiles meetingId="m1" />)

    await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('при смене встречи не показывает файлы предыдущей', async () => {
    fetchMock.mockImplementationOnce(respond([file({ name: 'первая.pdf' })]))
    const { rerender } = render(<MeetingFiles meetingId="m1" />)
    await screen.findByText('первая.pdf')

    fetchMock.mockReturnValueOnce(new Promise(() => undefined))
    rerender(<MeetingFiles meetingId="m2" />)

    expect(screen.queryByText('первая.pdf')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Загрузка файлов' })).toBeInTheDocument()
  })

  it('блок «Файлы» содержит зону загрузки, а после загрузки обновляет список', async () => {
    fetchMock.mockImplementationOnce(respond([]))
    render(<MeetingFiles meetingId="m1" />)
    await screen.findByText('Файлов пока нет')

    fetchMock.mockImplementationOnce(respond([file({ name: 'новый.pdf' })]))
    await userEvent.upload(
      screen.getByLabelText('Выбрать файлы'),
      new File(['x'], 'новый.pdf', { type: 'application/pdf' }),
    )

    expect(uploadFile).toHaveBeenCalledWith('m1', expect.any(File), expect.anything())
    const items = await screen.findAllByRole('listitem')
    expect(within(items[items.length - 1]).getByText('новый.pdf')).toBeInTheDocument()
    expect(screen.queryByText('Файлов пока нет')).not.toBeInTheDocument()
  })

  describe('скачивание', () => {
    it('у каждого файла есть ссылка на скачивание с исходным именем', async () => {
      fetchMock.mockImplementation(respond([file()]))
      render(<MeetingFiles meetingId="m1" />)

      const link = await screen.findByRole('link', { name: 'Скачать Протокол встречи.pdf' })
      expect(link).toHaveAttribute('href', '/api/meetings/m1/files/f1/download')
      expect(link).toHaveAttribute('download')
    })

    it('идентификаторы в ссылке экранируются', async () => {
      fetchMock.mockImplementation(respond([file({ id: 'a/b' })]))
      render(<MeetingFiles meetingId="m 1" />)

      const link = await screen.findByRole('link', { name: /Скачать/ })
      expect(link).toHaveAttribute('href', '/api/meetings/m%201/files/a%2Fb/download')
    })
  })

  describe('удаление', () => {
    const noContent = () => Promise.resolve(new Response(null, { status: 204 }))

    const openDialog = async (name = 'Протокол встречи.pdf') => {
      await userEvent.click(await screen.findByRole('button', { name: `Удалить ${name}` }))
      return screen.findByRole('alertdialog')
    }

    it('просит подтверждение и ничего не удаляет до него', async () => {
      fetchMock.mockImplementation(respond([file()]))
      render(<MeetingFiles meetingId="m1" />)

      const dialog = await openDialog()

      expect(within(dialog).getByText(/Протокол встречи\.pdf/)).toBeInTheDocument()
      expect(fetchMock).toHaveBeenCalledTimes(1) // только загрузка списка
    })

    it('«Отмена» закрывает диалог, файл остаётся', async () => {
      fetchMock.mockImplementation(respond([file()]))
      render(<MeetingFiles meetingId="m1" />)

      const dialog = await openDialog()
      await userEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))

      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(screen.getByText('Протокол встречи.pdf')).toBeInTheDocument()
    })

    it('подтверждение шлёт DELETE и убирает файл из списка', async () => {
      fetchMock.mockImplementationOnce(respond([file(), file({ id: 'f2', name: 'запись.mp4' })]))
      render(<MeetingFiles meetingId="m1" />)

      const dialog = await openDialog()
      fetchMock.mockImplementationOnce(noContent)
      await userEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }))

      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/meetings/m1/files/f1',
        expect.objectContaining({ method: 'DELETE' }),
      )
      await waitFor(() =>
        expect(screen.queryByText('Протокол встречи.pdf')).not.toBeInTheDocument(),
      )
      expect(screen.getByText('запись.mp4')).toBeInTheDocument()
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('после удаления последнего файла показывает пустой список', async () => {
      fetchMock.mockImplementationOnce(respond([file()]))
      render(<MeetingFiles meetingId="m1" />)

      const dialog = await openDialog()
      fetchMock.mockImplementationOnce(noContent)
      await userEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }))

      expect(await screen.findByText('Файлов пока нет')).toBeInTheDocument()
    })

    it('при ошибке показывает сообщение в диалоге, файл остаётся', async () => {
      fetchMock.mockImplementationOnce(respond([file()]))
      render(<MeetingFiles meetingId="m1" />)

      const dialog = await openDialog()
      fetchMock.mockImplementationOnce(respond({ message: 'Сбой диска' }, 500))
      await userEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }))

      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Сбой диска')
      // файл остался в списке (и назван в диалоге)
      expect(screen.getAllByText('Протокол встречи.pdf')).toHaveLength(2)
    })

    it('если файл уже удалён (404), он просто пропадает из списка', async () => {
      fetchMock.mockImplementationOnce(respond([file()]))
      render(<MeetingFiles meetingId="m1" />)

      const dialog = await openDialog()
      fetchMock.mockImplementationOnce(respond({ message: 'Not Found' }, 404))
      await userEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }))

      expect(await screen.findByText('Файлов пока нет')).toBeInTheDocument()
    })

    it('при 401 уводит на вход', async () => {
      fetchMock.mockImplementationOnce(respond([file()]))
      render(<MeetingFiles meetingId="m1" />)

      const dialog = await openDialog()
      fetchMock.mockImplementationOnce(respond({ message: 'Unauthorized' }, 401))
      await userEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }))

      await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'))
    })
  })
})
