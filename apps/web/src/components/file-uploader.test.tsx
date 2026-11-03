import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '@/lib/api'
import { MAX_UPLOAD_BYTES, uploadFile } from '@/lib/upload'
import { FileUploader } from './file-uploader'

vi.mock('@/lib/upload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/upload')>()),
  uploadFile: vi.fn(),
}))

interface Call {
  meetingId: string
  file: File
  onProgress: (loaded: number, total: number) => void
  signal?: AbortSignal
  resolve: () => void
  reject: (error: unknown) => void
}

// каждая загрузка «зависает», пока тест сам её не завершит
const calls: Call[] = []

beforeEach(() => {
  calls.length = 0
  vi.mocked(uploadFile).mockImplementation(
    (meetingId, file, options) =>
      new Promise<void>((resolve, reject) => {
        calls.push({
          meetingId,
          file,
          onProgress: options?.onProgress ?? (() => {}),
          signal: options?.signal,
          resolve,
          reject,
        })
      }),
  )
})

const makeFile = (name: string, size = 10) => new File([new Uint8Array(size)], name)

// File.size только для чтения: подменяем, чтобы не выделять 500 МБ
const hugeFile = (name: string, size: number) => {
  const f = makeFile(name)
  Object.defineProperty(f, 'size', { value: size })
  return f
}

const row = (name: string) => screen.getByText(name).closest('li') as HTMLElement

describe('FileUploader', () => {
  it('выбор нескольких файлов кнопкой запускает загрузку каждого в свою встречу', async () => {
    render(<FileUploader meetingId="m1" />)

    await userEvent.upload(screen.getByLabelText('Выбрать файлы'), [
      makeFile('a.txt'),
      makeFile('b.txt'),
    ])

    expect(calls.map((c) => [c.meetingId, c.file.name])).toEqual([
      ['m1', 'a.txt'],
      ['m1', 'b.txt'],
    ])
    expect(within(row('a.txt')).getByText('Загружается')).toBeInTheDocument()
    expect(within(row('b.txt')).getByText('Загружается')).toBeInTheDocument()
  })

  it('поле выбора принимает несколько файлов', () => {
    render(<FileUploader meetingId="m1" />)
    expect(screen.getByLabelText('Выбрать файлы')).toHaveAttribute('multiple')
  })

  it('drag-and-drop в зону запускает загрузку файлов', () => {
    render(<FileUploader meetingId="m1" />)

    fireEvent.drop(screen.getByTestId('drop-zone'), {
      dataTransfer: { files: [makeFile('a.txt'), makeFile('b.txt')] },
    })

    expect(calls.map((c) => c.file.name)).toEqual(['a.txt', 'b.txt'])
  })

  it('прогресс у каждого файла свой', async () => {
    render(<FileUploader meetingId="m1" />)
    await userEvent.upload(screen.getByLabelText('Выбрать файлы'), [
      makeFile('a.txt'),
      makeFile('b.txt'),
    ])

    act(() => calls[0].onProgress(50, 100))
    act(() => calls[1].onProgress(10, 100))

    expect(within(row('a.txt')).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
    expect(within(row('b.txt')).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '10')
  })

  it('onUploaded вызывается, когда завершилась вся очередь; до его завершения файлы показаны как «Загружен»', async () => {
    let finish!: () => void
    const onUploaded = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    render(<FileUploader meetingId="m1" onUploaded={onUploaded} />)
    await userEvent.upload(screen.getByLabelText('Выбрать файлы'), [
      makeFile('a.txt'),
      makeFile('b.txt'),
    ])

    await act(async () => calls[0].resolve())
    expect(within(row('a.txt')).getByText('Загружен')).toBeInTheDocument()
    expect(onUploaded).not.toHaveBeenCalled()

    await act(async () => calls[1].resolve())
    expect(onUploaded).toHaveBeenCalledTimes(1)
    expect(screen.getByText('a.txt')).toBeInTheDocument()

    await act(async () => finish())
    expect(screen.queryByText('a.txt')).not.toBeInTheDocument()
    expect(screen.queryByText('b.txt')).not.toBeInTheDocument()
  })

  it('одновременно грузятся не больше трёх файлов, остальные ждут в очереди', async () => {
    render(<FileUploader meetingId="m1" />)
    await userEvent.upload(
      screen.getByLabelText('Выбрать файлы'),
      ['a', 'b', 'c', 'd'].map((n) => makeFile(`${n}.txt`)),
    )

    expect(calls.map((c) => c.file.name)).toEqual(['a.txt', 'b.txt', 'c.txt'])
    expect(within(row('d.txt')).getByText('В очереди')).toBeInTheDocument()

    await act(async () => calls[0].resolve())

    expect(calls.map((c) => c.file.name)).toEqual(['a.txt', 'b.txt', 'c.txt', 'd.txt'])
    expect(within(row('d.txt')).getByText('Загружается')).toBeInTheDocument()
  })

  it('«Отменить» прерывает идущую загрузку и убирает строку, ожидающий файл не стартует', async () => {
    render(<FileUploader meetingId="m1" />)
    await userEvent.upload(
      screen.getByLabelText('Выбрать файлы'),
      ['a', 'b', 'c', 'd'].map((n) => makeFile(`${n}.txt`)),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Отменить a.txt' }))
    expect(calls[0].signal?.aborted).toBe(true)
    expect(screen.queryByText('a.txt')).not.toBeInTheDocument()
    await act(async () => calls[0].reject(new DOMException('прервано', 'AbortError')))
    expect(calls.map((c) => c.file.name)).toEqual(['a.txt', 'b.txt', 'c.txt', 'd.txt'])

    await userEvent.click(screen.getByRole('button', { name: 'Отменить d.txt' }))
    expect(screen.queryByText('d.txt')).not.toBeInTheDocument()
  })

  it('«Убрать» удаляет упавший файл из очереди', async () => {
    render(<FileUploader meetingId="m1" />)
    await userEvent.upload(screen.getByLabelText('Выбрать файлы'), [makeFile('a.txt')])
    await act(async () => calls[0].reject(new ApiError('Ошибка', 500)))

    await userEvent.click(screen.getByRole('button', { name: 'Убрать a.txt' }))

    expect(screen.queryByText('a.txt')).not.toBeInTheDocument()
  })

  it('сообщения об отказе накапливаются и закрываются кнопкой', async () => {
    render(<FileUploader meetingId="m1" />)
    const input = screen.getByLabelText('Выбрать файлы')
    await userEvent.upload(input, [hugeFile('big.bin', MAX_UPLOAD_BYTES + 1)])
    await userEvent.upload(input, [makeFile('ok.txt'), hugeFile('big.bin', MAX_UPLOAD_BYTES + 1)])

    expect(within(screen.getByRole('alert')).getAllByRole('listitem')).toHaveLength(2)

    await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('подсветка зоны не гаснет при переходе курсора на дочерний элемент', () => {
    render(<FileUploader meetingId="m1" />)
    const zone = screen.getByTestId('drop-zone')
    const child = screen.getByText('Перетащите файлы сюда или выберите на устройстве')

    fireEvent.dragEnter(zone)
    // jsdom не знает DragEvent и теряет relatedTarget в init
    const leave = (relatedTarget: Node) => {
      const event = createEvent.dragLeave(zone)
      Object.defineProperty(event, 'relatedTarget', { value: relatedTarget })
      fireEvent(zone, event)
    }
    leave(child)
    expect(zone).toHaveClass('border-accent')

    leave(document.body)
    expect(zone).not.toHaveClass('border-accent')
  })

  it('файл, брошенный мимо зоны, не открывается браузером', () => {
    render(<FileUploader meetingId="m1" />)
    const event = new Event('drop', { cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'] } })

    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it('файл больше 500 МБ не отправляется, показывается понятное сообщение', async () => {
    render(<FileUploader meetingId="m1" />)

    await userEvent.upload(screen.getByLabelText('Выбрать файлы'), [
      hugeFile('big.bin', MAX_UPLOAD_BYTES + 1),
      makeFile('ok.txt'),
    ])

    expect(calls.map((c) => c.file.name)).toEqual(['ok.txt'])
    expect(screen.getByRole('alert')).toHaveTextContent('big.bin')
    expect(screen.getByRole('alert')).toHaveTextContent('больше 500 МБ')
  })

  it('файл ровно 500 МБ отправляется', async () => {
    render(<FileUploader meetingId="m1" />)
    await userEvent.upload(screen.getByLabelText('Выбрать файлы'), [
      hugeFile('edge.bin', MAX_UPLOAD_BYTES),
    ])
    expect(calls).toHaveLength(1)
  })

  it('ошибка одного файла не мешает другому; у упавшего есть сообщение и «Повторить»', async () => {
    const onUploaded = vi.fn()
    render(<FileUploader meetingId="m1" onUploaded={onUploaded} />)
    await userEvent.upload(screen.getByLabelText('Выбрать файлы'), [
      makeFile('a.txt'),
      makeFile('b.txt'),
    ])

    await act(async () => calls[0].reject(new ApiError('Нет места на диске', 500)))
    await act(async () => calls[1].resolve())

    expect(within(row('a.txt')).getByText('Ошибка')).toBeInTheDocument()
    expect(within(row('a.txt')).getByText('Нет места на диске')).toBeInTheDocument()
    expect(screen.queryByText('b.txt')).not.toBeInTheDocument()
    expect(onUploaded).toHaveBeenCalledTimes(1)
  })

  it('«Повторить» заново отправляет упавший файл', async () => {
    const onUploaded = vi.fn()
    render(<FileUploader meetingId="m1" onUploaded={onUploaded} />)
    await userEvent.upload(screen.getByLabelText('Выбрать файлы'), [makeFile('a.txt')])
    await act(async () => calls[0].reject(new ApiError('Не удалось связаться с сервером', 0)))

    await userEvent.click(within(row('a.txt')).getByRole('button', { name: 'Повторить' }))

    expect(calls).toHaveLength(2)
    expect(calls[1].file.name).toBe('a.txt')
    expect(within(row('a.txt')).getByText('Загружается')).toBeInTheDocument()

    await act(async () => calls[1].resolve())
    expect(screen.queryByText('a.txt')).not.toBeInTheDocument()
    expect(onUploaded).toHaveBeenCalledTimes(1)
  })

  it('401 уводит на вход через onUnauthorized', async () => {
    const onUnauthorized = vi.fn()
    render(<FileUploader meetingId="m1" onUnauthorized={onUnauthorized} />)
    await userEvent.upload(screen.getByLabelText('Выбрать файлы'), [makeFile('a.txt')])

    await act(async () => calls[0].reject(new ApiError('Unauthorized', 401)))

    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('при размонтировании активные загрузки прерываются', async () => {
    const { unmount } = render(<FileUploader meetingId="m1" />)
    await userEvent.upload(screen.getByLabelText('Выбрать файлы'), [makeFile('a.txt')])

    unmount()

    expect(calls[0].signal?.aborted).toBe(true)
  })
})
