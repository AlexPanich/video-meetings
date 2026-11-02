/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- тела ответов supertest не типизированы */
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { App } from 'supertest/types.js'
import { AppModule } from './../src/app.module.js'

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

  const upload = (auth: string, meetingId: string, content: Buffer, filename: string) =>
    http()
      .post(`/meetings/${meetingId}/files`)
      .set('Authorization', auth)
      .attach('file', content, { filename, contentType: 'text/plain' })

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
    delete process.env.MAX_UPLOAD_SIZE
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
      process.env.MAX_UPLOAD_SIZE = '10'

      await upload(auth, meetingId, Buffer.alloc(100, 'x'), 'big.txt').expect(413)

      const dir = join(process.env.UPLOADS_DIR!, meetingId)
      expect(await readdir(dir).catch(() => [])).toEqual([])
      const list = await http().get(`/meetings/${meetingId}/files`).set('Authorization', auth)
      expect(list.body).toEqual([])
    })

    it('413 сразу по Content-Length, не читая тело', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)
      process.env.MAX_UPLOAD_SIZE = '10'

      await upload(auth, meetingId, Buffer.alloc(200 * 1024, 'x'), 'big.txt').expect(413)
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
})
