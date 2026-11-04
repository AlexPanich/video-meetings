import type { IncomingMessage } from 'node:http'
import { PassThrough } from 'node:stream'
import { UnsupportedMediaTypeException } from '@nestjs/common'
import { receiveSingleFile } from './multipart.js'

const BOUNDARY = 'unit-boundary'

const FILE_HEAD = Buffer.from(
  `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\n` +
    'Content-Type: application/octet-stream\r\n\r\nstart',
)
const FILE_TAIL = Buffer.from(`\r\n--${BOUNDARY}--\r\n`)

const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms))

const fakeRequest = () => {
  const request = new PassThrough() as unknown as PassThrough & IncomingMessage
  request.headers = { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` }
  request.complete = false
  const setHeader = vi.fn()
  ;(request as unknown as { res: { setHeader: typeof setHeader } }).res = { setHeader }
  return { request, setHeader }
}

// onFile сразу отказывает (как проверка сигнатуры аватара), пока клиент ещё присылает тело
const start = (drainOnFailure: boolean, maxSize = 1024) => {
  const { request, setHeader } = fakeRequest()
  let settled = false
  const result = receiveSingleFile(request, {
    maxSize,
    drainOnFailure,
    onFile: (stream) => {
      stream.resume()
      return Promise.reject(new UnsupportedMediaTypeException('Неподдерживаемый формат'))
    },
  })
  const outcome = result.then(
    () => 'resolved',
    (error: unknown) => {
      settled = true
      return error
    },
  )
  request.write(FILE_HEAD)
  return { request, setHeader, outcome, isSettled: () => settled }
}

describe('receiveSingleFile: отказ, пока клиент ещё присылает тело', () => {
  it('без drainOnFailure отвечает сразу и просит закрыть соединение', async () => {
    const { setHeader, outcome, isSettled } = start(false)
    await tick()

    expect(isSettled()).toBe(true)
    expect(await outcome).toBeInstanceOf(UnsupportedMediaTypeException)
    expect(setHeader).toHaveBeenCalledWith('Connection', 'close')
  })

  it('с drainOnFailure ждёт конца тела и не закрывает соединение', async () => {
    const { request, setHeader, outcome, isSettled } = start(true)
    await tick()
    expect(isSettled()).toBe(false)

    request.write(Buffer.alloc(512, 1))
    await tick()
    expect(isSettled()).toBe(false)

    request.complete = true
    request.end(FILE_TAIL)

    expect(await outcome).toBeInstanceOf(UnsupportedMediaTypeException)
    expect(setHeader).not.toHaveBeenCalled()
  })

  it('с drainOnFailure сдаётся и закрывает соединение, если тело превышает лимит', async () => {
    const { request, setHeader, outcome } = start(true, 10)
    await tick()

    // лимит дочитывания: maxSize + запас на заголовки multipart (64 КБ)
    request.write(Buffer.alloc(80 * 1024, 1))

    expect(await outcome).toBeInstanceOf(UnsupportedMediaTypeException)
    expect(setHeader).toHaveBeenCalledWith('Connection', 'close')
  })
})
