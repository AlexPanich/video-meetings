import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AvatarEditor } from './avatar-editor'

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  router.refresh.mockReset()
  router.refresh.mockReturnValue(undefined)
  router.replace.mockReset()
})

const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as Response

const me = { id: '1', email: 'ivan@example.com', name: 'Иван Петров' }

const pick = async (file: File) => {
  const input = screen.getByLabelText('Выбрать изображение')
  await userEvent.setup({ applyAccept: false }).upload(input, file)
}

const png = () => new File(['x'], 'me.png', { type: 'image/png' })

describe('AvatarEditor: загрузка', () => {
  it('отправляет PUT /api/profile/avatar с файлом и обновляет страницы', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ...me, hasAvatar: true, avatarVersion: 5 }))
    render(<AvatarEditor name={me.name} hasAvatar={false} avatarVersion={null} />)
    await pick(png())

    await waitFor(() => expect(router.refresh).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/profile/avatar')
    expect(init.method).toBe('PUT')
    expect((init.body as FormData).get('file')).toBeInstanceOf(File)
  })

  it('не отправляет файл больше 5 МБ и показывает причину', async () => {
    render(<AvatarEditor name={me.name} hasAvatar={false} avatarVersion={null} />)
    const big = png()
    Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 })
    await pick(big)

    expect(await screen.findByText('Файл больше 5 МБ')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('не отправляет файл не JPEG/PNG/WebP и показывает причину', async () => {
    render(<AvatarEditor name={me.name} hasAvatar={false} avatarVersion={null} />)
    await pick(new File(['x'], 'doc.pdf', { type: 'application/pdf' }))

    expect(await screen.findByText('Допустимы только JPEG, PNG и WebP')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Браузер и ОС иногда отдают для валидной картинки пустой или нестандартный MIME: решает сигнатура
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])
  it.each([
    ['пустым', ''],
    ['нестандартным', 'image/jpg'],
  ])('отправляет JPEG с %s MIME-типом', async (_, type) => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ...me, hasAvatar: true, avatarVersion: 5 }))
    render(<AvatarEditor name={me.name} hasAvatar={false} avatarVersion={null} />)
    await pick(new File([jpegBytes], 'me.jpg', { type }))

    await waitFor(() => expect(router.refresh).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Допустимы только JPEG, PNG и WebP')).not.toBeInTheDocument()
  })

  it('не отправляет файл с пустым MIME и чужой сигнатурой', async () => {
    render(<AvatarEditor name={me.name} hasAvatar={false} avatarVersion={null} />)
    await pick(new File(['%PDF-1.7 not an image'], 'me', { type: '' }))

    expect(await screen.findByText('Допустимы только JPEG, PNG и WebP')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('выбор файла пропускает расширения картинок, а не только MIME-типы', () => {
    render(<AvatarEditor name={me.name} hasAvatar={false} avatarVersion={null} />)
    const accept = screen.getByLabelText('Выбрать изображение').getAttribute('accept') ?? ''
    expect(accept.split(',')).toEqual(
      expect.arrayContaining(['image/jpeg', '.jpg', '.png', '.webp']),
    )
  })

  it('показывает ошибку API и не меняет текущий аватар', async () => {
    fetchMock.mockResolvedValue(jsonResponse(415, { message: 'Неподдерживаемый формат' }))
    const { container } = render(<AvatarEditor name={me.name} hasAvatar avatarVersion={7} />)
    await pick(png())

    expect(await screen.findByText('Неподдерживаемый формат')).toBeInTheDocument()
    expect(router.refresh).not.toHaveBeenCalled()
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/profile/avatar?v=7')
  })

  it('при 401 уводит на /login', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'Unauthorized' }))
    render(<AvatarEditor name={me.name} hasAvatar={false} avatarVersion={null} />)
    await pick(png())

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'))
  })
})

describe('AvatarEditor: удаление', () => {
  it('кнопки удаления нет, пока аватара нет', () => {
    render(<AvatarEditor name={me.name} hasAvatar={false} avatarVersion={null} />)
    expect(screen.queryByRole('button', { name: 'Удалить аватар' })).not.toBeInTheDocument()
  })

  it('просит подтверждение и ничего не удаляет до него', async () => {
    render(<AvatarEditor name={me.name} hasAvatar avatarVersion={1} />)
    await userEvent.click(screen.getByRole('button', { name: 'Удалить аватар' }))

    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('после подтверждения шлёт DELETE и обновляет страницы', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response)
    render(<AvatarEditor name={me.name} hasAvatar avatarVersion={1} />)
    await userEvent.click(screen.getByRole('button', { name: 'Удалить аватар' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }))

    await waitFor(() => expect(router.refresh).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/profile/avatar')
    expect(init.method).toBe('DELETE')
  })

  const openDialog = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Удалить аватар' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }))
    return dialog
  }

  it('при 401 закрывает диалог и уводит на /login', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'Unauthorized' }))
    render(<AvatarEditor name={me.name} hasAvatar avatarVersion={1} />)
    await openDialog()

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(router.refresh).not.toHaveBeenCalled()
  })

  it('404 считается успехом: диалог закрывается, страницы обновляются', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { message: 'Not Found' }))
    render(<AvatarEditor name={me.name} hasAvatar avatarVersion={1} />)
    await openDialog()

    await waitFor(() => expect(router.refresh).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('при 500 показывает ошибку в диалоге и не обновляет страницы', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { message: 'Сбой сервера' }))
    const { container } = render(<AvatarEditor name={me.name} hasAvatar avatarVersion={3} />)
    const dialog = await openDialog()

    expect(await within(dialog).findByText('Сбой сервера')).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(router.refresh).not.toHaveBeenCalled()
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/profile/avatar?v=3')
  })

  it('убирает старую ошибку загрузки после удаления', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(415, { message: 'Неподдерживаемый формат' }))
    render(<AvatarEditor name={me.name} hasAvatar avatarVersion={1} />)
    await pick(png())
    expect(await screen.findByText('Неподдерживаемый формат')).toBeInTheDocument()

    fetchMock.mockResolvedValueOnce({ ok: true, status: 204 } as Response)
    await openDialog()

    await waitFor(() => expect(router.refresh).toHaveBeenCalled())
    expect(screen.queryByText('Неподдерживаемый формат')).not.toBeInTheDocument()
  })
})

describe('AvatarEditor: доступность', () => {
  it('ошибка загрузки объявляется как role="alert"', async () => {
    render(<AvatarEditor name={me.name} hasAvatar={false} avatarVersion={null} />)
    await pick(new File(['x'], 'doc.pdf', { type: 'application/pdf' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Допустимы только JPEG, PNG и WebP')
  })
})

describe('AvatarEditor: фокус и индикатор после изменений', () => {
  // router.refresh() возвращает промис: переход (и pending) длится, пока он не разрешится
  let finishRefresh = () => {}
  const holdRefresh = () => {
    router.refresh.mockReturnValue(new Promise<void>((resolve) => (finishRefresh = resolve)))
  }
  // незавершённый async-переход React 19 связал бы с переходами следующих тестов
  afterEach(async () => {
    await act(async () => finishRefresh())
  })

  it('после удаления возвращает фокус с <body> на «Загрузить фото»', async () => {
    const { rerender } = render(<AvatarEditor name={me.name} hasAvatar avatarVersion={1} />)
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(document.activeElement).toBe(document.body)

    rerender(<AvatarEditor name={me.name} hasAvatar={false} avatarVersion={null} />)

    const upload = screen.getByRole('button', { name: 'Загрузить фото' })
    await waitFor(() => expect(upload).toHaveFocus(), { timeout: 1000 })
  })

  it('не перехватывает фокус, если он уже на другом элементе', async () => {
    const Page = ({ hasAvatar }: { hasAvatar: boolean }) => (
      <>
        <button type="button">Другое</button>
        <AvatarEditor name={me.name} hasAvatar={hasAvatar} avatarVersion={hasAvatar ? 1 : null} />
      </>
    )
    const { rerender } = render(<Page hasAvatar />)
    const other = screen.getByRole('button', { name: 'Другое' })
    other.focus()

    rerender(<Page hasAvatar={false} />)
    await new Promise((resolve) => setTimeout(resolve, 400))

    expect(other).toHaveFocus()
  })

  it('держит pending до конца перехода и не шлёт второй запрос', async () => {
    holdRefresh()
    fetchMock.mockResolvedValue(jsonResponse(200, { ...me, hasAvatar: true, avatarVersion: 5 }))
    render(<AvatarEditor name={me.name} hasAvatar avatarVersion={1} />)

    await pick(png())
    await waitFor(() => expect(router.refresh).toHaveBeenCalled())

    const replace = screen.getByRole('button', { name: 'Заменить' })
    expect(replace).toHaveAttribute('data-pending', 'true')
    expect(screen.getByRole('button', { name: 'Удалить аватар' })).toBeDisabled()

    await pick(png())
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(replace).toHaveAttribute('data-pending', 'true')

    await act(async () => finishRefresh())
    await waitFor(() => expect(replace).not.toHaveAttribute('data-pending'))
  })

  it('держит pending после удаления до конца перехода', async () => {
    holdRefresh()
    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response)
    render(<AvatarEditor name={me.name} hasAvatar avatarVersion={1} />)
    await userEvent.click(screen.getByRole('button', { name: 'Удалить аватар' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }))

    await waitFor(() => expect(router.refresh).toHaveBeenCalled())
    const replace = screen.getByRole('button', { name: 'Заменить' })
    expect(replace).toHaveAttribute('data-pending', 'true')

    await act(async () => finishRefresh())
    await waitFor(() => expect(replace).not.toHaveAttribute('data-pending'))
  })
})
