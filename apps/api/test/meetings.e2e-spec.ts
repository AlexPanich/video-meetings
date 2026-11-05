/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- тела ответов supertest не типизированы */
import { randomUUID } from 'node:crypto'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { App } from 'supertest/types.js'
import { AppModule } from './../src/app.module.js'

const JWT_SECRET = 'e2e-test-secret-at-least-32-bytes-long'
const PASSWORD = 'Str0ngPassw0rd!'

const uniqueEmail = () => `user-${randomUUID()}@example.com`

describe('Meetings (e2e)', () => {
  let app: INestApplication<App>

  const http = () => request(app.getHttpServer())

  // регистрирует нового пользователя и возвращает заголовок авторизации
  const createUser = async () => {
    const { body } = await http()
      .post('/auth/register')
      .send({ email: uniqueEmail(), password: PASSWORD, name: 'Alice' })
      .expect(201)
    return `Bearer ${body.accessToken}`
  }

  const meetingBody = (overrides: object = {}) => ({
    title: 'Планёрка',
    date: '2030-01-15T10:00:00.000Z',
    participants: ['bob@example.com', 'carol@example.com'],
    ...overrides,
  })

  const createMeeting = (auth: string, body: object = meetingBody()) =>
    http().post('/meetings').set('Authorization', auth).send(body)

  beforeAll(() => {
    process.env.JWT_SECRET = JWT_SECRET
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

  describe('POST /meetings', () => {
    it('создаёт встречу и возвращает её с id', async () => {
      const auth = await createUser()

      const res = await createMeeting(auth).expect(201)

      expect(res.body).toMatchObject({
        id: expect.any(String),
        title: 'Планёрка',
        date: '2030-01-15T10:00:00.000Z',
        participants: ['bob@example.com', 'carol@example.com'],
      })
    })

    it('привязывает встречу к текущему пользователю', async () => {
      const auth = await createUser()
      const me = await http().get('/auth/me').set('Authorization', auth).expect(200)

      const res = await createMeeting(auth).expect(201)

      expect(res.body.ownerId).toBe(me.body.id)
    })

    it('допускает пустой список участников', async () => {
      const auth = await createUser()

      const res = await createMeeting(auth, meetingBody({ participants: [] })).expect(201)

      expect(res.body.participants).toEqual([])
    })

    it('созданная встреча доступна по GET /meetings/:id', async () => {
      const auth = await createUser()
      const { body: created } = await createMeeting(auth).expect(201)

      const res = await http().get(`/meetings/${created.id}`).set('Authorization', auth).expect(200)

      expect(res.body).toEqual(created)
    })

    it('возвращает 401 без авторизации', async () => {
      await http().post('/meetings').send(meetingBody()).expect(401)
    })

    it.each([
      ['title отсутствует', { title: undefined }],
      ['title пустой', { title: '' }],
      ['title не строка', { title: 123 }],
      ['date отсутствует', { date: undefined }],
      ['date не является датой', { date: 'not-a-date' }],
      ['participants отсутствует', { participants: undefined }],
      ['participants не массив', { participants: 'bob@example.com' }],
      ['participants содержит не строку', { participants: [1, 2] }],
    ])('возвращает 400, если %s', async (_title, overrides) => {
      const auth = await createUser()

      await createMeeting(auth, meetingBody(overrides)).expect(400)
    })
  })

  describe('GET /meetings', () => {
    it('возвращает пустой список, если у пользователя нет встреч', async () => {
      const auth = await createUser()

      const res = await http().get('/meetings').set('Authorization', auth).expect(200)

      expect(res.body).toEqual([])
    })

    it('возвращает все встречи текущего пользователя', async () => {
      const auth = await createUser()
      const first = await createMeeting(auth, meetingBody({ title: 'Первая' })).expect(201)
      const second = await createMeeting(auth, meetingBody({ title: 'Вторая' })).expect(201)

      const res = await http().get('/meetings').set('Authorization', auth).expect(200)

      expect(res.body).toHaveLength(2)
      expect(res.body.map((m: { id: string }) => m.id)).toEqual(
        expect.arrayContaining([first.body.id, second.body.id]),
      )
    })

    it('не возвращает встречи других пользователей', async () => {
      const alice = await createUser()
      const bob = await createUser()
      const aliceMeeting = await createMeeting(alice, meetingBody({ title: 'Алисина' })).expect(201)
      await createMeeting(bob, meetingBody({ title: 'Бобова' })).expect(201)

      const res = await http().get('/meetings').set('Authorization', alice).expect(200)

      expect(res.body).toHaveLength(1)
      expect(res.body[0].id).toBe(aliceMeeting.body.id)
    })

    it('возвращает 401 без авторизации', async () => {
      await http().get('/meetings').expect(401)
    })
  })

  describe('GET /meetings/:id', () => {
    it('возвращает встречу по id', async () => {
      const auth = await createUser()
      const { body: created } = await createMeeting(auth).expect(201)

      const res = await http().get(`/meetings/${created.id}`).set('Authorization', auth).expect(200)

      expect(res.body).toMatchObject({
        id: created.id,
        title: 'Планёрка',
        date: '2030-01-15T10:00:00.000Z',
        participants: ['bob@example.com', 'carol@example.com'],
      })
    })

    it('возвращает 404, если встреча не найдена', async () => {
      const auth = await createUser()

      await http().get(`/meetings/${randomUUID()}`).set('Authorization', auth).expect(404)
    })

    it('возвращает 404 для id не в формате uuid', async () => {
      const auth = await createUser()

      await http().get('/meetings/not-a-uuid').set('Authorization', auth).expect(404)
    })

    it('возвращает 404 для встречи другого пользователя', async () => {
      const alice = await createUser()
      const bob = await createUser()
      const { body: aliceMeeting } = await createMeeting(alice).expect(201)

      await http().get(`/meetings/${aliceMeeting.id}`).set('Authorization', bob).expect(404)
    })

    it('возвращает 401 без авторизации', async () => {
      const auth = await createUser()
      const { body: created } = await createMeeting(auth).expect(201)

      await http().get(`/meetings/${created.id}`).expect(401)
    })
  })
})
