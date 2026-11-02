import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotFoundException, StreamableFile } from '@nestjs/common'
import type { QueryBus } from '@nestjs/cqrs'
import { DownloadMeetingFileHandler } from './download-meeting-file.handler.js'
import { DownloadMeetingFileQuery } from './download-meeting-file.query.js'

describe('DownloadMeetingFileHandler', () => {
  let uploadsDir: string
  let prisma: { meetingFile: { findFirst: ReturnType<typeof vi.fn> } }
  let queryBus: { execute: ReturnType<typeof vi.fn> }
  let handler: DownloadMeetingFileHandler

  const query = new DownloadMeetingFileQuery('u1', 'm1', 'f1')

  beforeEach(async () => {
    uploadsDir = await mkdtemp(join(tmpdir(), 'uploads-unit-'))
    process.env.UPLOADS_DIR = uploadsDir
    prisma = { meetingFile: { findFirst: vi.fn() } }
    queryBus = { execute: vi.fn().mockResolvedValue({ id: 'm1' }) }
    handler = new DownloadMeetingFileHandler(prisma as never, queryBus as unknown as QueryBus)
  })

  afterEach(async () => {
    delete process.env.UPLOADS_DIR
    await rm(uploadsDir, { recursive: true, force: true })
  })

  it('отдаёт поток с исходным именем, MIME-типом и размером', async () => {
    prisma.meetingFile.findFirst.mockResolvedValue({
      id: 'f1',
      name: 'Отчёт.pdf',
      storageName: 'stored',
      mimeType: 'application/pdf',
    })
    await mkdir(join(uploadsDir, 'm1'))
    await writeFile(join(uploadsDir, 'm1', 'stored'), 'содержимое')

    const result = await handler.execute(query)

    expect(result).toBeInstanceOf(StreamableFile)
    expect(result.getHeaders()).toMatchObject({
      type: 'application/pdf',
      length: Buffer.byteLength('содержимое'),
    })
    expect(result.getHeaders().disposition).toMatch(/^attachment; .*filename\*=UTF-8''/)
    result.getStream().destroy()
  })

  it('ищет только загруженный файл именно этой встречи', async () => {
    prisma.meetingFile.findFirst.mockResolvedValue(null)

    await expect(handler.execute(query)).rejects.toBeInstanceOf(NotFoundException)

    expect(prisma.meetingFile.findFirst).toHaveBeenCalledWith({
      where: { id: 'f1', meetingId: 'm1', status: 'uploaded' },
    })
  })

  it('404, если файла нет на диске', async () => {
    prisma.meetingFile.findFirst.mockResolvedValue({
      id: 'f1',
      name: 'x.txt',
      storageName: 'missing',
      mimeType: 'text/plain',
    })

    await expect(handler.execute(query)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('не читает файл, если нет доступа к встрече', async () => {
    queryBus.execute.mockRejectedValue(new NotFoundException())

    await expect(handler.execute(query)).rejects.toBeInstanceOf(NotFoundException)

    expect(prisma.meetingFile.findFirst).not.toHaveBeenCalled()
  })
})
