/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- тела ответов supertest не типизированы */
import { randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { App } from 'supertest/types.js'
import { AppModule } from './../src/app.module.js'

const PASSWORD = 'Str0ngPassw0rd!'
const MAX_AVATAR_BYTES = 5 * 1024 * 1024

const filler = (size: number) => Buffer.alloc(size, 7)

// минимальные буферы с настоящими сигнатурами форматов
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), filler(64)])
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  filler(64),
])
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x40, 0, 0, 0]),
  Buffer.from('WEBP'),
  filler(64),
])
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
const TEXT = Buffer.from('это вовсе не картинка')

describe('Avatar (e2e)', () => {
  let app: INestApplication<App>

  const http = () => request(app.getHttpServer())
  const avatarsDir = () => join(process.env.UPLOADS_DIR!, 'avatars')
  const listAvatars = () => readdir(avatarsDir()).catch(() => [] as string[])

  const registerUser = async () => {
    const { body } = await http()
      .post('/auth/register')
      .send({ email: `user-${randomUUID()}@example.com`, password: PASSWORD, name: 'Alice' })
      .expect(201)
    return `Bearer ${body.accessToken}`
  }

  const put = (auth: string, content: Buffer, filename = 'avatar.png', contentType = 'image/png') =>
    http()
      .put('/profile/avatar')
      .set('Authorization', auth)
      .attach('file', content, { filename, contentType })

  const get = (auth: string) =>
    http()
      .get('/profile/avatar')
      .set('Authorization', auth)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => cb(null, Buffer.concat(chunks)))
      })

  const del = (auth: string) => http().delete('/profile/avatar').set('Authorization', auth)

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
    await app.close()
  })

  describe('PUT /profile/avatar', () => {
    it.each([
      ['JPG', JPG, 'avatar.jpg', 'image/jpeg'],
      ['PNG', PNG, 'avatar.png', 'image/png'],
      ['WebP', WEBP, 'avatar.webp', 'image/webp'],
    ])('загружает %s, GET возвращает те же байты и MIME-тип', async (_, content, name, mime) => {
      const auth = await registerUser()

      const res = await put(auth, content, name, mime).expect(200)
      expect(res.body).not.toHaveProperty('passwordHash')

      const got = await get(auth).expect(200)
      expect(got.headers['content-type']).toContain(mime)
      expect(got.headers['x-content-type-options']).toBe('nosniff')
      expect(Buffer.compare(got.body as Buffer, content)).toBe(0)
    })

    it('в ответе и в GET /auth/me нет passwordHash', async () => {
      const auth = await registerUser()

      const res = await put(auth, PNG).expect(200)
      expect(res.body).not.toHaveProperty('passwordHash')

      const meRes = await http().get('/auth/me').set('Authorization', auth).expect(200)
      expect(meRes.body).not.toHaveProperty('passwordHash')
    })

    it('замена: выдаётся новый файл, прежний удалён с диска', async () => {
      const auth = await registerUser()
      const before = await listAvatars()

      await put(auth, PNG).expect(200)
      const afterFirst = await listAvatars()
      expect(afterFirst).toHaveLength(before.length + 1)

      await put(auth, JPG, 'a.jpg', 'image/jpeg').expect(200)
      const afterSecond = await listAvatars()
      expect(afterSecond).toHaveLength(afterFirst.length)

      const oldName = afterFirst.find((n) => !before.includes(n))!
      expect(afterSecond).not.toContain(oldName)

      const got = await get(auth).expect(200)
      expect(got.headers['content-type']).toContain('image/jpeg')
      expect(Buffer.compare(got.body as Buffer, JPG)).toBe(0)
    })

    it('принимает файл ровно 5 МБ', async () => {
      const auth = await registerUser()

      const exact = Buffer.concat([PNG, filler(MAX_AVATAR_BYTES - PNG.length)])
      expect(exact.length).toBe(MAX_AVATAR_BYTES)
      await put(auth, exact).expect(200)

      const got = await get(auth).expect(200)
      expect((got.body as Buffer).length).toBe(MAX_AVATAR_BYTES)
    })

    it('413 для файла больше 5 МБ, текущий аватар не меняется', async () => {
      const auth = await registerUser()
      await put(auth, PNG).expect(200)
      const before = await listAvatars()

      const big = Buffer.concat([PNG, filler(MAX_AVATAR_BYTES)])
      await put(auth, big).expect(413)

      expect(await listAvatars()).toEqual(before)
      const got = await get(auth).expect(200)
      expect(Buffer.compare(got.body as Buffer, PNG)).toBe(0)
    })

    it.each([
      ['SVG', SVG, 'avatar.svg', 'image/svg+xml'],
      ['SVG под видом PNG', SVG, 'avatar.png', 'image/png'],
      ['текст с расширением .png и MIME image/png', TEXT, 'avatar.png', 'image/png'],
      ['GIF-сигнатура под видом JPG', Buffer.from('GIF89a......'), 'a.jpg', 'image/jpeg'],
    ])('отклоняет %s, текущий аватар не меняется', async (_, content, name, mime) => {
      const auth = await registerUser()
      await put(auth, PNG).expect(200)
      const before = await listAvatars()

      await put(auth, content, name, mime).expect(415)

      expect(await listAvatars()).toEqual(before)
      const got = await get(auth).expect(200)
      expect(got.headers['content-type']).toContain('image/png')
      expect(Buffer.compare(got.body as Buffer, PNG)).toBe(0)
    })

    // отказ по формату возникает на первых байтах; если сразу закрыть сокет, пока клиент ещё
    // шлёт тело, часть клиентов получит обрыв (EPIPE/ECONNRESET) вместо ответа 415
    it('отвечает 415, а не обрывает соединение, на большом файле неверного формата', async () => {
      const auth = await registerUser()
      await app.listen(0)
      const { port } = (app.getHttpServer() as Server).address() as AddressInfo

      const boundary = 'raw-boundary'
      const head = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n` +
          'Content-Type: image/png\r\n\r\n%PDF-1.4\n',
      )
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
      const payload = filler(4 * 1024 * 1024)
      const length = head.length + payload.length + tail.length
      const chunk = 64 * 1024

      // так прокси Next передаёт тело в API: fetch с потоковым телом (duplex: 'half')
      const send = async (): Promise<string> => {
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(head)
            for (let at = 0; at < payload.length; at += chunk) {
              controller.enqueue(payload.subarray(at, at + chunk))
              // медленный клиент: к моменту отказа тело ещё не отправлено до конца
              await new Promise((resolve) => setTimeout(resolve, 3))
            }
            controller.enqueue(tail)
            controller.close()
          },
        })
        try {
          const init: RequestInit & { duplex: 'half' } = {
            method: 'PUT',
            headers: {
              Authorization: auth,
              'Content-Type': `multipart/form-data; boundary=${boundary}`,
              'Content-Length': String(length),
            },
            body,
            duplex: 'half',
          }
          const res = await fetch(`http://127.0.0.1:${port}/profile/avatar`, init)
          await res.arrayBuffer()
          return String(res.status)
        } catch (error) {
          const cause = (error as { cause?: { code?: string } }).cause
          return cause?.code ?? 'FETCH_ERROR'
        }
      }

      const outcomes: string[] = []
      for (let i = 0; i < 10; i++) outcomes.push(await send())

      expect(outcomes).toEqual(Array(10).fill('415'))
    }, 60_000)

    it('MIME-тип берётся по сигнатуре, а не из заголовка клиента', async () => {
      const auth = await registerUser()

      await put(auth, PNG, 'avatar.jpg', 'image/jpeg').expect(200)

      const got = await get(auth).expect(200)
      expect(got.headers['content-type']).toContain('image/png')
    })

    it('401 без токена', async () => {
      await http().put('/profile/avatar').attach('file', PNG, 'a.png').expect(401)
    })
  })

  describe('GET /profile/avatar', () => {
    it('404, если аватара нет', async () => {
      const auth = await registerUser()
      await get(auth).expect(404)
    })

    it('отдаёт только свой аватар', async () => {
      const alice = await registerUser()
      const bob = await registerUser()
      await put(alice, PNG).expect(200)

      await get(bob).expect(404)
    })

    it('401 без токена', async () => {
      await http().get('/profile/avatar').expect(401)
    })
  })

  describe('DELETE /profile/avatar', () => {
    it('удаляет аватар: запись очищена, файла на диске нет', async () => {
      const auth = await registerUser()
      const before = await listAvatars()
      await put(auth, PNG).expect(200)

      await del(auth).expect(204)

      expect(await listAvatars()).toEqual(before)
      await get(auth).expect(404)
    })

    it('404, если аватара нет', async () => {
      const auth = await registerUser()
      await del(auth).expect(404)
    })

    it('после удаления можно загрузить новый', async () => {
      const auth = await registerUser()
      await put(auth, PNG).expect(200)
      await del(auth).expect(204)

      await put(auth, WEBP, 'a.webp', 'image/webp').expect(200)
      await get(auth).expect(200)
    })

    it('401 без токена', async () => {
      await http().delete('/profile/avatar').expect(401)
    })
  })
})
