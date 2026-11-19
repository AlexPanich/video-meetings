/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- тела ответов supertest не типизированы */
import { randomUUID } from 'node:crypto'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { App } from 'supertest/types.js'
import { AppModule } from './../src/app.module.js'
import { PrismaService } from './../src/prisma/prisma.service.js'

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

  describe('POST /meetings: правила названия, участников и даты', () => {
    // сообщения ValidationPipe — массив строк; понятное сообщение — на русском и называет поле
    const expectMessage = (body: { message: unknown }, pattern: RegExp) => {
      const messages: string[] = Array.isArray(body.message) ? body.message : [String(body.message)]
      expect(messages.some((m) => pattern.test(m))).toBe(true)
    }

    const names = (count: number) => Array.from({ length: count }, (_, i) => `Участник ${i + 1}`)

    it.each([
      ['пустое', ''],
      ['из одних пробелов', '   '],
      ['из пробельных символов и табуляции', ' \t '],
      ['длиннее 200 символов', 'а'.repeat(201)],
      ['длиннее 200 символов после обрезки', `  ${'а'.repeat(201)}  `],
      ['с нулевым байтом', 'План\u0000ёрка'],
      ['с управляющим символом', 'План\u0007ёрка'],
      ['с переводом строки внутри', 'План\nёрка'],
      ['с DEL', 'План\u007fёрка'],
    ])('400 с понятным сообщением, если название %s', async (_title, title) => {
      const auth = await createUser()

      const res = await createMeeting(auth, meetingBody({ title })).expect(400)

      expectMessage(res.body, /назван/i)
    })

    it('принимает название ровно из 200 символов после обрезки', async () => {
      const auth = await createUser()
      const title = 'а'.repeat(200)

      const res = await createMeeting(auth, meetingBody({ title: `  ${title}  ` })).expect(201)

      expect(res.body.title).toBe(title)
    })

    it.each([
      ['пустое', ''],
      ['из одних пробелов', '   '],
      ['длиннее 100 символов', 'б'.repeat(101)],
      ['длиннее 100 символов после обрезки', ` ${'б'.repeat(101)} `],
      ['с нулевым байтом', 'Боб\u0000'],
      ['с управляющим символом', 'Б\u001bоб'],
      ['с переводом строки внутри', 'Боб\nКэрол'],
    ])('400 с понятным сообщением, если имя участника %s', async (_title, name) => {
      const auth = await createUser()

      const res = await createMeeting(auth, meetingBody({ participants: ['Алиса', name] })).expect(
        400,
      )

      expectMessage(res.body, /участник/i)
    })

    it('принимает имя участника ровно из 100 символов после обрезки', async () => {
      const auth = await createUser()
      const name = 'б'.repeat(100)

      const res = await createMeeting(auth, meetingBody({ participants: [` ${name} `] })).expect(
        201,
      )

      expect(res.body.participants).toEqual([name])
    })

    it('400 с понятным сообщением для 51 участника', async () => {
      const auth = await createUser()

      const res = await createMeeting(auth, meetingBody({ participants: names(51) })).expect(400)

      expectMessage(res.body, /участник/i)
    })

    it('принимает 50 участников', async () => {
      const auth = await createUser()

      const res = await createMeeting(auth, meetingBody({ participants: names(50) })).expect(201)

      expect(res.body.participants).toEqual(names(50))
    })

    it.each([
      ['отсутствует', undefined],
      ['null', null],
      ['пустая строка', ''],
      ['не дата', 'not-a-date'],
      ['в формате ДД.ММ.ГГГГ', '15.01.2030'],
      ['в формате ММ/ДД/ГГГГ', '01/15/2030'],
      ['число (timestamp)', 1894701600000],
      ['строка с timestamp', '1894701600000'],
      ['несуществующий день', '2030-02-30T10:00:00.000Z'],
    ])('400 с понятным сообщением, если дата %s', async (_title, date) => {
      const auth = await createUser()

      const res = await createMeeting(auth, meetingBody({ date })).expect(400)

      expectMessage(res.body, /дат/i)
    })

    it.each([
      ['прошедшую', '2000-01-01T00:00:00.000Z'],
      ['будущую', '2099-12-31T23:00:00.000Z'],
    ])('принимает %s дату', async (_title, date) => {
      const auth = await createUser()

      const res = await createMeeting(auth, meetingBody({ date })).expect(201)

      expect(res.body.date).toBe(date)
    })

    it('принимает дату ISO 8601 со смещением часового пояса и хранит её в UTC', async () => {
      const auth = await createUser()

      const res = await createMeeting(
        auth,
        meetingBody({ date: '2030-01-15T15:00:00+03:00' }),
      ).expect(201)

      expect(res.body.date).toBe('2030-01-15T12:00:00.000Z')
    })

    it('обрезает пробелы по краям названия и имён, убирает повторы участников без учёта регистра', async () => {
      const auth = await createUser()
      const { body: created } = await createMeeting(
        auth,
        meetingBody({
          title: '  Планёрка команды \t',
          participants: [' Алиса ', 'Боб', 'алиса', '  БОБ', 'Кэрол', 'АЛИСА  '],
        }),
      ).expect(201)

      const res = await http().get(`/meetings/${created.id}`).set('Authorization', auth).expect(200)

      expect(res.body.title).toBe('Планёрка команды')
      // сохраняется первое написание, порядок — по первому вхождению
      expect(res.body.participants).toEqual(['Алиса', 'Боб', 'Кэрол'])
    })

    it('встреча без участников создаётся с пустым списком', async () => {
      const auth = await createUser()
      const { body: created } = await createMeeting(auth, meetingBody({ participants: [] })).expect(
        201,
      )

      const res = await http().get(`/meetings/${created.id}`).set('Authorization', auth).expect(200)

      expect(res.body.participants).toEqual([])
    })

    it('встреча, записанная в БД в обход правил, отдаётся GET /meetings и GET /meetings/:id', async () => {
      const auth = await createUser()
      const me = await http().get('/auth/me').set('Authorization', auth).expect(200)
      const legacy = {
        title: `  ${'x'.repeat(300)}\u0007  `,
        participants: ['', '   ', 'Боб', 'боб', 'б'.repeat(150), 'Кэ\nрол', ...names(60)],
      }
      const stored = await app.get(PrismaService).meeting.create({
        data: { ...legacy, date: new Date('2020-05-01T09:00:00.000Z'), ownerId: me.body.id },
      })

      const list = await http().get('/meetings').set('Authorization', auth).expect(200)
      expect(list.body).toHaveLength(1)
      expect(list.body[0]).toMatchObject({ id: stored.id, ...legacy })

      const one = await http().get(`/meetings/${stored.id}`).set('Authorization', auth).expect(200)
      expect(one.body).toMatchObject({
        id: stored.id,
        ...legacy,
        date: '2020-05-01T09:00:00.000Z',
      })
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
