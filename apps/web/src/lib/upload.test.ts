import { ApiError } from './api'
import { MAX_UPLOAD_BYTES, uploadFile } from './upload'

class FakeXhr {
  static last: FakeXhr
  method = ''
  url = ''
  body: unknown
  status = 0
  responseText = ''
  aborted = false
  withCredentials = false
  upload: { onprogress: ((e: ProgressEventInit) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  constructor() {
    FakeXhr.last = this
  }
  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  send(body: unknown) {
    this.body = body
  }
  abort() {
    this.aborted = true
    this.onabort?.()
  }
  respond(status: number, body: unknown = null) {
    this.status = status
    this.responseText = body === null ? '' : JSON.stringify(body)
    this.onload?.()
  }
}

const file = new File(['hello'], 'Протокол.txt', { type: 'text/plain' })

beforeEach(() => {
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('uploadFile', () => {
  it('лимит совпадает с API: 500 МиБ', () => {
    expect(MAX_UPLOAD_BYTES).toBe(500 * 1024 * 1024)
  })

  it('шлёт POST multipart с полем file на /api/meetings/:id/files', async () => {
    const promise = uploadFile('m 1', file)
    const xhr = FakeXhr.last

    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe('/api/meetings/m%201/files')
    expect(xhr.body).toBeInstanceOf(FormData)
    expect((xhr.body as FormData).get('file')).toBeInstanceOf(File)
    expect(((xhr.body as FormData).get('file') as File).name).toBe('Протокол.txt')

    xhr.respond(201, { id: 'f1' })
    await expect(promise).resolves.toBeUndefined()
  })

  it('сообщает о прогрессе отправки', async () => {
    const onProgress = vi.fn()
    const promise = uploadFile('m1', file, { onProgress })
    FakeXhr.last.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 200 })
    FakeXhr.last.upload.onprogress?.({ lengthComputable: false, loaded: 10, total: 0 })

    expect(onProgress).toHaveBeenCalledTimes(1)
    expect(onProgress).toHaveBeenCalledWith(50, 200)

    FakeXhr.last.respond(201, {})
    await promise
  })

  it('на ответ с ошибкой бросает ApiError с сообщением API и статусом', async () => {
    const promise = uploadFile('m1', file)
    FakeXhr.last.respond(413, { message: 'Файл слишком большой' })

    await expect(promise).rejects.toMatchObject({
      name: 'Error',
      message: 'Файл слишком большой',
      status: 413,
    })
    await expect(promise).rejects.toBeInstanceOf(ApiError)
  })

  it('на ответ без читаемого тела бросает ApiError с общим сообщением', async () => {
    const promise = uploadFile('m1', file)
    FakeXhr.last.respond(502)

    await expect(promise).rejects.toMatchObject({ status: 502, message: 'Что-то пошло не так' })
  })

  it('на сетевую ошибку бросает ApiError со статусом 0', async () => {
    const promise = uploadFile('m1', file)
    FakeXhr.last.onerror?.()

    await expect(promise).rejects.toMatchObject({
      status: 0,
      message: 'Не удалось связаться с сервером',
    })
  })

  it('AbortSignal прерывает запрос', async () => {
    const controller = new AbortController()
    const promise = uploadFile('m1', file, { signal: controller.signal })
    controller.abort()

    expect(FakeXhr.last.aborted).toBe(true)
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('уже прерванный сигнал не открывает запрос', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(uploadFile('m1', file, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
