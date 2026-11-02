import type { IncomingMessage } from 'node:http'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { NotFoundException, PayloadTooLargeException } from '@nestjs/common'
import type { QueryBus } from '@nestjs/cqrs'
import { UploadMeetingFileHandler } from './upload-meeting-file.handler.js'
import { UploadMeetingFileCommand } from './upload-meeting-file.command.js'

const BOUNDARY = 'unit-boundary'

const multipartBody = (content: Buffer, filename = 'notes.txt') =>
  Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        'Content-Type: text/plain\r\n\r\n',
    ),
    content,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ])

// минимальная замена IncomingMessage: поток с заголовками и признаком полностью принятого тела
const fakeRequest = (body: Buffer) => {
  const request = new PassThrough() as unknown as PassThrough & IncomingMessage
  request.headers = {
    'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
    'content-length': String(body.length),
  }
  request.complete = true
  return request
}

describe('UploadMeetingFileHandler', () => {
  let uploadsDir: string
  let prisma: {
    meetingFile: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }
  }
  let handler: UploadMeetingFileHandler

  const record = { id: 'f1', meetingId: 'm1', storageName: 'stored', name: 'notes.txt' }

  beforeEach(async () => {
    uploadsDir = await mkdtemp(join(tmpdir(), 'uploads-unit-'))
    process.env.UPLOADS_DIR = uploadsDir
    prisma = {
      meetingFile: {
        create: vi.fn().mockImplementation(({ data }: { data: object }) =>
          // как у Prisma: возвращается промис
          Promise.resolve({ ...record, ...data, createdAt: new Date(), size: 0 }),
        ),
        update: vi
          .fn()
          .mockImplementation(({ data }: { data: object }) => ({ ...record, ...data })),
      },
    }
    const queryBus = { execute: vi.fn().mockResolvedValue({ id: 'm1' }) }
    handler = new UploadMeetingFileHandler(prisma as never, queryBus as unknown as QueryBus)
  })

  afterEach(async () => {
    delete process.env.UPLOADS_DIR
    delete process.env.MAX_UPLOAD_BYTES
    await rm(uploadsDir, { recursive: true, force: true })
  })

  const run = (request: IncomingMessage) =>
    handler.execute(new UploadMeetingFileCommand('u1', 'm1', request))

  const filesOnDisk = () => readdir(join(uploadsDir, 'm1')).catch(() => [] as string[])

  it('успех: пишет файл на диск и ставит статус uploaded с фактическим размером', async () => {
    const content = Buffer.from('hello, meeting')
    const body = multipartBody(content)
    const request = fakeRequest(body)
    const promise = run(request)
    request.end(body)

    const result = await promise

    expect(result).toMatchObject({ status: 'uploaded', size: content.length })
    expect(prisma.meetingFile.update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: { status: 'uploaded', size: content.length },
    })
    const [stored] = await filesOnDisk()
    expect(await readFile(join(uploadsDir, 'm1', stored))).toEqual(content)
  })

  it('превышение лимита: 413, файл удалён с диска, запись failed', async () => {
    process.env.MAX_UPLOAD_BYTES = '10'
    const body = multipartBody(Buffer.alloc(100, 'x'))
    const request = fakeRequest(body)
    // Content-Length заранее не выдаёт превышение: проверяется счёт принятых байтов
    request.headers['content-length'] = '1'
    const promise = run(request)
    request.end(body)

    await expect(promise).rejects.toBeInstanceOf(PayloadTooLargeException)

    expect(await filesOnDisk()).toEqual([])
    expect(prisma.meetingFile.update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: { status: 'failed' },
    })
  })

  it('ошибка потока запроса: загрузка отклонена, файл удалён, запись failed', async () => {
    const body = multipartBody(Buffer.alloc(1024, 'x'))
    const request = fakeRequest(body)
    const promise = run(request)
    // отправляем начало файла и роняем поток, не дойдя до конца тела
    request.write(body.subarray(0, body.length - 200))
    // ждём, пока начнётся запись файла на диск, и только потом роняем поток
    await vi.waitFor(async () => expect(await filesOnDisk()).toHaveLength(1))
    request.destroy(new Error('socket hang up'))

    await expect(promise).rejects.toThrow('Загрузка прервана')

    expect(await filesOnDisk()).toEqual([])
    expect(prisma.meetingFile.update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: { status: 'failed' },
    })
  })

  it('сбой записи в БД не повисает: запрос отклоняется', async () => {
    prisma.meetingFile.create.mockRejectedValue(new Error('db down'))
    const body = multipartBody(Buffer.from('data'))
    const request = fakeRequest(body)
    const promise = run(request)
    request.end(body)

    await expect(promise).rejects.toThrow('db down')
  })

  it('сбой записи на диск не повисает: запрос отклоняется, запись failed', async () => {
    process.env.UPLOADS_DIR = join(uploadsDir, 'file-in-the-way')
    await writeFile(process.env.UPLOADS_DIR, 'не каталог') // mkdir упадёт с ENOTDIR/EEXIST
    const body = multipartBody(Buffer.from('data'))
    const request = fakeRequest(body)
    const promise = run(request)
    request.end(body)

    await expect(promise).rejects.toThrow()
    expect(prisma.meetingFile.update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: { status: 'failed' },
    })
  })

  it('клиент отключился до начала чтения тела: запрос отклоняется', async () => {
    const body = multipartBody(Buffer.from('data'))
    const request = fakeRequest(body)
    request.destroy()

    await expect(run(request)).rejects.toThrow('Загрузка прервана')
  })

  it('поздняя ошибка запроса после успешной загрузки не откатывает файл', async () => {
    const body = multipartBody(Buffer.from('data'))
    const request = fakeRequest(body)
    const promise = run(request)
    request.end(body)
    await promise

    request.emit('error', new Error('ECONNRESET'))
    await new Promise((resolve) => setImmediate(resolve))

    expect(await filesOnDisk()).toHaveLength(1)
    expect(prisma.meetingFile.update).not.toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: { status: 'failed' },
    })
  })

  it('встречу удалили во время загрузки (P2025 при финализации): 404, файл и каталог убраны', async () => {
    // и финализация, и пометка failed упираются в уже удалённую запись
    prisma.meetingFile.update.mockRejectedValue(
      Object.assign(new Error('not found'), { code: 'P2025' }),
    )
    const body = multipartBody(Buffer.from('data'))
    const request = fakeRequest(body)
    const promise = run(request)
    request.end(body)

    await expect(promise).rejects.toBeInstanceOf(NotFoundException)

    expect(await readdir(uploadsDir)).toEqual([])
  })

  it('встречу удалили между проверкой владельца и созданием записи (P2003): 404', async () => {
    prisma.meetingFile.create.mockRejectedValue(Object.assign(new Error('fk'), { code: 'P2003' }))
    const body = multipartBody(Buffer.from('data'))
    const request = fakeRequest(body)
    const promise = run(request)
    request.end(body)

    await expect(promise).rejects.toBeInstanceOf(NotFoundException)
  })
})
