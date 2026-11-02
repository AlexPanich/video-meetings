/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- тела ответов supertest не типизированы */
import { randomUUID } from 'node:crypto'
import { readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { connect, type AddressInfo } from 'node:net'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { App } from 'supertest/types.js'
import { AppModule } from './../src/app.module.js'
import { PrismaService } from './../src/prisma/prisma.service.js'

const PASSWORD = 'Str0ngPassw0rd!'

const uniqueEmail = () => `user-${randomUUID()}@example.com`

describe('Meeting files (e2e)', () => {
  let app: INestApplication<App>

  const http = () => request(app.getHttpServer())

  const createUser = async () => {
    const { body } = await http()
      .post('/auth/register')
      .send({ email: uniqueEmail(), password: PASSWORD, name: 'Alice' })
      .expect(201)
    return `Bearer ${body.accessToken}`
  }

  const createMeeting = async (auth: string): Promise<string> => {
    const { body } = await http()
      .post('/meetings')
      .set('Authorization', auth)
      .send({ title: 'Планёрка', date: '2030-01-15T10:00:00.000Z', participants: [] })
      .expect(201)
    return body.id as string
  }

  const upload = (
    auth: string,
    meetingId: string,
    content: Buffer,
    filename: string,
    contentType = 'text/plain',
  ) =>
    http()
      .post(`/meetings/${meetingId}/files`)
      .set('Authorization', auth)
      .attach('file', content, { filename, contentType })

  // тела ответов supertest не типизированы: достаём id явно
  const idOf = (body: unknown) => (body as { id: string }).id

  const binary = (size: number) =>
    Buffer.from(Array.from({ length: size }, (_, i) => (i * 31) % 256))

  const download = (auth: string, meetingId: string, fileId: string) =>
    http()
      .get(`/meetings/${meetingId}/files/${fileId}/download`)
      .set('Authorization', auth)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => cb(null, Buffer.concat(chunks)))
      })

  beforeAll(() => {
    process.env.UPLOADS_DIR ??= join(process.cwd(), 'uploads-e2e')
  })

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  })

  afterEach(async () => {
    delete process.env.MAX_UPLOAD_BYTES
    await app.close()
  })

  describe('POST /meetings/:id/files', () => {
    it('загружает файл и возвращает запись со статусом uploaded', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)
      const content = Buffer.from('hello, meeting')

      const res = await upload(auth, meetingId, content, 'notes.txt').expect(201)

      expect(res.body).toMatchObject({
        meetingId,
        name: 'notes.txt',
        size: content.length,
        mimeType: 'text/plain',
        status: 'uploaded',
      })
      expect(res.body.id).toEqual(expect.any(String))
      expect(res.body.createdAt).toEqual(expect.any(String))
    })

    it('сохраняет исходное имя с кириллицей без искажений', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)

      const res = await upload(
        auth,
        meetingId,
        Buffer.from('данные'),
        'Протокол встречи №1.txt',
      ).expect(201)

      expect(res.body.name).toBe('Протокол встречи №1.txt')
    })

    it('пишет на диск под сгенерированным именем, а не исходным', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)
      const content = Buffer.from('содержимое файла')

      await upload(auth, meetingId, content, 'secret-name.txt').expect(201)

      const dir = join(process.env.UPLOADS_DIR!, meetingId)
      const names = await readdir(dir)
      expect(names).toHaveLength(1)
      expect(names[0]).not.toContain('secret-name')
      expect(await readFile(join(dir, names[0]))).toEqual(content)
    })

    it('принимает несколько файлов в одну встречу', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)

      await upload(auth, meetingId, Buffer.from('один'), 'a.txt').expect(201)
      await upload(auth, meetingId, Buffer.from('два'), 'b.txt').expect(201)

      expect(await readdir(join(process.env.UPLOADS_DIR!, meetingId))).toHaveLength(2)
    })

    it('413, если файл больше лимита: на диске и в списке ничего не остаётся', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)
      process.env.MAX_UPLOAD_BYTES = '10'

      await upload(auth, meetingId, Buffer.alloc(100, 'x'), 'big.txt').expect(413)

      const dir = join(process.env.UPLOADS_DIR!, meetingId)
      expect(await readdir(dir).catch(() => [])).toEqual([])
      const list = await http().get(`/meetings/${meetingId}/files`).set('Authorization', auth)
      expect(list.body).toEqual([])
    })

    it('принимает файл ровно в размер лимита', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)
      process.env.MAX_UPLOAD_BYTES = '10'

      const res = await upload(auth, meetingId, Buffer.alloc(10, 'x'), 'edge.txt').expect(201)

      expect(res.body).toMatchObject({ size: 10, status: 'uploaded' })
    })

    it('413 на файл на байт больше лимита', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)
      process.env.MAX_UPLOAD_BYTES = '10'

      await upload(auth, meetingId, Buffer.alloc(11, 'x'), 'edge.txt').expect(413)
    })

    it('413 сразу по Content-Length, не читая тело', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)
      process.env.MAX_UPLOAD_BYTES = '10'

      await upload(auth, meetingId, Buffer.alloc(200 * 1024, 'x'), 'big.txt').expect(413)
    })

    it('обрыв соединения посреди загрузки: запись failed, файла на диске нет', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)
      await app.listen(0)
      const { port } = (app.getHttpServer() as Server).address() as AddressInfo

      const boundary = 'e2e-boundary'
      const head =
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cut.bin"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n'
      const socket = connect(port, '127.0.0.1')
      await new Promise<void>((resolve) => socket.once('connect', resolve))
      // заявляем тело в 1 МБ, отправляем лишь часть и рвём соединение
      socket.write(
        `POST /meetings/${meetingId}/files HTTP/1.1\r\nHost: localhost\r\n` +
          `Authorization: ${auth}\r\n` +
          `Content-Type: multipart/form-data; boundary=${boundary}\r\n` +
          'Content-Length: 1048576\r\n\r\n' +
          head,
      )
      socket.write(Buffer.alloc(4096, 'x'))
      await new Promise((resolve) => setTimeout(resolve, 200))
      socket.destroy()

      const prisma = app.get(PrismaService)
      await vi.waitFor(
        async () => {
          const rows = await prisma.meetingFile.findMany({ where: { meetingId } })
          expect(rows).toHaveLength(1)
          expect(rows[0].status).toBe('failed')
        },
        { timeout: 5000, interval: 100 },
      )
      const dir = join(process.env.UPLOADS_DIR!, meetingId)
      expect(await readdir(dir).catch(() => [])).toEqual([])
      const list = await http().get(`/meetings/${meetingId}/files`).set('Authorization', auth)
      expect(list.body).toEqual([])
    })

    it('400, если файл передан не в поле file', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)

      await http()
        .post(`/meetings/${meetingId}/files`)
        .set('Authorization', auth)
        .attach('document', Buffer.from('x'), 'x.txt')
        .expect(400)

      const list = await http().get(`/meetings/${meetingId}/files`).set('Authorization', auth)
      expect(list.body).toEqual([])
    })

    it('400 при двух файлах в запросе, ни один не сохраняется', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)

      await http()
        .post(`/meetings/${meetingId}/files`)
        .set('Authorization', auth)
        .attach('file', Buffer.from('один'), 'a.txt')
        .attach('file', Buffer.from('два'), 'b.txt')
        .expect(400)

      const list = await http().get(`/meetings/${meetingId}/files`).set('Authorization', auth)
      expect(list.body).toEqual([])
    })

    it('обрезает слишком длинное имя файла до 255 символов', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)

      const res = await upload(auth, meetingId, Buffer.from('x'), `${'a'.repeat(400)}.txt`).expect(
        201,
      )

      expect(res.body.name).toHaveLength(255)
    })

    it('400, если в теле нет файла', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)

      await http()
        .post(`/meetings/${meetingId}/files`)
        .set('Authorization', auth)
        .field('title', 'не файл')
        .expect(400)
    })

    it('401 без токена', async () => {
      await http()
        .post(`/meetings/${randomUUID()}/files`)
        .attach('file', Buffer.from('x'), 'x.txt')
        .expect(401)
    })

    it('404 для чужой встречи, файл не пишется', async () => {
      const owner = await createUser()
      const stranger = await createUser()
      const meetingId = await createMeeting(owner)

      await upload(stranger, meetingId, Buffer.from('x'), 'x.txt').expect(404)

      await expect(readdir(join(process.env.UPLOADS_DIR!, meetingId))).rejects.toThrow()
    })

    it('404 для несуществующей встречи', async () => {
      const auth = await createUser()

      await upload(auth, randomUUID(), Buffer.from('x'), 'x.txt').expect(404)
    })
  })

  describe('GET /meetings/:id/files', () => {
    it('возвращает загруженные файлы встречи', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)
      await upload(auth, meetingId, Buffer.from('один'), 'Файл один.txt').expect(201)
      await upload(auth, meetingId, Buffer.from('два!'), 'two.txt').expect(201)

      const res = await http()
        .get(`/meetings/${meetingId}/files`)
        .set('Authorization', auth)
        .expect(200)

      expect(res.body).toHaveLength(2)
      expect(res.body.map((f: { name: string }) => f.name).sort()).toEqual([
        'two.txt',
        'Файл один.txt',
      ])
      for (const file of res.body) {
        expect(file).toMatchObject({ meetingId, status: 'uploaded' })
      }
    })

    it('пустой список для встречи без файлов', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)

      const res = await http()
        .get(`/meetings/${meetingId}/files`)
        .set('Authorization', auth)
        .expect(200)

      expect(res.body).toEqual([])
    })

    it('не смешивает файлы разных встреч', async () => {
      const auth = await createUser()
      const first = await createMeeting(auth)
      const second = await createMeeting(auth)
      await upload(auth, first, Buffer.from('x'), 'first.txt').expect(201)

      const res = await http()
        .get(`/meetings/${second}/files`)
        .set('Authorization', auth)
        .expect(200)

      expect(res.body).toEqual([])
    })

    it('401 без токена', async () => {
      await http().get(`/meetings/${randomUUID()}/files`).expect(401)
    })

    it('404 для чужой встречи', async () => {
      const owner = await createUser()
      const stranger = await createUser()
      const meetingId = await createMeeting(owner)
      await upload(owner, meetingId, Buffer.from('x'), 'x.txt').expect(201)

      await http().get(`/meetings/${meetingId}/files`).set('Authorization', stranger).expect(404)
    })
  })

  describe('GET /meetings/:id/files/:fileId/download', () => {
    it('отдаёт файл побайтно идентичным с исходным именем и MIME-типом', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)
      const content = binary(70_000)
      const { body: file } = await upload(
        auth,
        meetingId,
        content,
        'Протокол встречи №1.bin',
        'application/octet-stream',
      ).expect(201)

      const res = await download(auth, meetingId, idOf(file)).expect(200)

      expect(res.body).toEqual(content)
      expect(res.headers['content-type']).toContain('application/octet-stream')
      expect(res.headers['content-length']).toBe(String(content.length))
      const disposition = res.headers['content-disposition']
      expect(disposition).toMatch(/^attachment;/)
      expect(disposition).toContain(
        `filename*=UTF-8''${encodeURIComponent('Протокол встречи №1.bin')}`,
      )
      expect(res.headers['x-content-type-options']).toBe('nosniff')
    })

    it('не ломает заголовок на скобках и апострофе в имени', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)
      const { body: file } = await upload(auth, meetingId, Buffer.from('x'), "a(1)'*.txt").expect(
        201,
      )

      const res = await download(auth, meetingId, idOf(file)).expect(200)

      expect(res.headers['content-disposition']).toContain(`filename*=UTF-8''a%281%29%27%2A.txt`)
    })

    it('401 без токена', async () => {
      await http().get(`/meetings/${randomUUID()}/files/${randomUUID()}/download`).expect(401)
    })

    it('404 для чужой встречи', async () => {
      const owner = await createUser()
      const stranger = await createUser()
      const meetingId = await createMeeting(owner)
      const { body: file } = await upload(owner, meetingId, Buffer.from('x'), 'x.txt').expect(201)

      await download(stranger, meetingId, idOf(file)).expect(404)
    })

    it('404 для файла другой своей встречи и несуществующего файла', async () => {
      const auth = await createUser()
      const first = await createMeeting(auth)
      const second = await createMeeting(auth)
      const { body: file } = await upload(auth, first, Buffer.from('x'), 'x.txt').expect(201)

      await download(auth, second, idOf(file)).expect(404)
      await download(auth, first, randomUUID()).expect(404)
    })

    it('404 для файла не в статусе uploaded', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)
      const failed = await app.get(PrismaService).meetingFile.create({
        data: {
          meetingId,
          name: 'f.txt',
          storageName: randomUUID(),
          mimeType: 'text/plain',
          status: 'failed',
        },
      })

      await download(auth, meetingId, failed.id).expect(404)
    })

    it('404, если файл пропал с диска, а не 500', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)
      const { body: file } = await upload(auth, meetingId, Buffer.from('x'), 'x.txt').expect(201)
      const dir = join(process.env.UPLOADS_DIR!, meetingId)
      await rm(dir, { recursive: true })

      await download(auth, meetingId, idOf(file)).expect(404)
    })
  })

  describe('DELETE /meetings/:id/files/:fileId', () => {
    it('удаляет запись из БД и файл с диска', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)
      const { body: keep } = await upload(auth, meetingId, Buffer.from('keep'), 'keep.txt').expect(
        201,
      )
      const { body: gone } = await upload(auth, meetingId, Buffer.from('gone'), 'gone.txt').expect(
        201,
      )
      const dir = join(process.env.UPLOADS_DIR!, meetingId)
      expect(await readdir(dir)).toHaveLength(2)

      await http()
        .delete(`/meetings/${meetingId}/files/${idOf(gone)}`)
        .set('Authorization', auth)
        .expect(204)

      expect(
        await app.get(PrismaService).meetingFile.findUnique({ where: { id: idOf(gone) } }),
      ).toBeNull()
      expect(await readdir(dir)).toHaveLength(1)
      const list = await http().get(`/meetings/${meetingId}/files`).set('Authorization', auth)
      expect(list.body.map((f: { id: string }) => f.id)).toEqual([keep.id])
      await download(auth, meetingId, idOf(gone)).expect(404)
    })

    it('повторное удаление даёт 404', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)
      const { body: file } = await upload(auth, meetingId, Buffer.from('x'), 'x.txt').expect(201)
      const remove = () =>
        http()
          .delete(`/meetings/${meetingId}/files/${idOf(file)}`)
          .set('Authorization', auth)

      await remove().expect(204)
      await remove().expect(404)
    })

    it('401 без токена', async () => {
      await http().delete(`/meetings/${randomUUID()}/files/${randomUUID()}`).expect(401)
    })

    it('404 для чужой встречи: файл остаётся', async () => {
      const owner = await createUser()
      const stranger = await createUser()
      const meetingId = await createMeeting(owner)
      const { body: file } = await upload(owner, meetingId, Buffer.from('x'), 'x.txt').expect(201)

      await http()
        .delete(`/meetings/${meetingId}/files/${idOf(file)}`)
        .set('Authorization', stranger)
        .expect(404)

      expect(await readdir(join(process.env.UPLOADS_DIR!, meetingId))).toHaveLength(1)
      await download(owner, meetingId, idOf(file)).expect(200)
    })

    it('404 для файла другой встречи', async () => {
      const auth = await createUser()
      const first = await createMeeting(auth)
      const second = await createMeeting(auth)
      const { body: file } = await upload(auth, first, Buffer.from('x'), 'x.txt').expect(201)

      await http()
        .delete(`/meetings/${second}/files/${idOf(file)}`)
        .set('Authorization', auth)
        .expect(404)
    })
  })

  describe('DELETE /meetings/:id', () => {
    it('удаляет встречу, записи файлов и физические файлы с диска', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)
      await upload(auth, meetingId, Buffer.from('один'), 'a.txt').expect(201)
      await upload(auth, meetingId, Buffer.from('два'), 'b.txt').expect(201)
      const dir = join(process.env.UPLOADS_DIR!, meetingId)
      expect(await readdir(dir)).toHaveLength(2)

      await http().delete(`/meetings/${meetingId}`).set('Authorization', auth).expect(204)

      await expect(readdir(dir)).rejects.toThrow()
      expect(await app.get(PrismaService).meetingFile.count({ where: { meetingId } })).toBe(0)
      await http().get(`/meetings/${meetingId}`).set('Authorization', auth).expect(404)
    })

    it('удаляет встречу без файлов', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)

      await http().delete(`/meetings/${meetingId}`).set('Authorization', auth).expect(204)
      await http().delete(`/meetings/${meetingId}`).set('Authorization', auth).expect(404)
    })

    it('401 без токена', async () => {
      await http().delete(`/meetings/${randomUUID()}`).expect(401)
    })

    it('404 для чужой встречи: встреча и файлы остаются', async () => {
      const owner = await createUser()
      const stranger = await createUser()
      const meetingId = await createMeeting(owner)
      await upload(owner, meetingId, Buffer.from('x'), 'x.txt').expect(201)

      await http().delete(`/meetings/${meetingId}`).set('Authorization', stranger).expect(404)

      await http().get(`/meetings/${meetingId}`).set('Authorization', owner).expect(200)
      expect(await readdir(join(process.env.UPLOADS_DIR!, meetingId))).toHaveLength(1)
    })
  })
})
