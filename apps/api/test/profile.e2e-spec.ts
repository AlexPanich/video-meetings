/* eslint-disable @typescript-eslint/no-unsafe-member-access -- тела ответов supertest не типизированы */
import { randomUUID } from 'node:crypto'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { App } from 'supertest/types.js'
import { AppModule } from './../src/app.module.js'

const PASSWORD = 'Str0ngPassw0rd!'
const uniqueEmail = () => `user-${randomUUID()}@example.com`

describe('Profile (e2e)', () => {
  let app: INestApplication<App>

  const http = () => request(app.getHttpServer())

  const registerUser = async (name = 'Alice') => {
    const email = uniqueEmail()
    const res = await http().post('/auth/register').send({ email, password: PASSWORD, name })
    return { email, token: res.body.accessToken as string, id: res.body.user.id as string }
  }

  const me = (token: string) => http().get('/auth/me').set('Authorization', `Bearer ${token}`)
  const patch = (token: string, body: object) =>
    http().patch('/profile').set('Authorization', `Bearer ${token}`).send(body)

  beforeAll(() => {
    process.env.JWT_SECRET = 'e2e-test-secret'
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

  describe('PATCH /profile', () => {
    it('меняет имя и возвращает публичные данные без passwordHash', async () => {
      const { email, token, id } = await registerUser()

      const res = await patch(token, { name: 'Bob' }).expect(200)

      expect(res.body).toEqual({ id, email, name: 'Bob', hasAvatar: false, avatarVersion: null })
      expect(res.body).not.toHaveProperty('passwordHash')
    })

    it('новое имя сразу видно в GET /auth/me', async () => {
      const { token } = await registerUser()

      await patch(token, { name: 'Bob' }).expect(200)

      const res = await me(token).expect(200)
      expect(res.body.name).toBe('Bob')
    })

    it('обрезает пробелы по краям имени', async () => {
      const { token } = await registerUser()

      const res = await patch(token, { name: '  Bob  ' }).expect(200)

      expect(res.body.name).toBe('Bob')
    })

    it.each([[''], ['   '], ['\t\n']])('отклоняет пустое имя %j кодом 400', async (name) => {
      const { token } = await registerUser()

      await patch(token, { name }).expect(400)

      const res = await me(token).expect(200)
      expect(res.body.name).toBe('Alice')
    })

    it.each([
      ['нулевой байт', 'a\u0000b'],
      ['управляющий символ', 'a\u0007b'],
      ['перевод строки внутри', 'a\nb'],
      ['zero-width space', '​'],
      ['только невидимые символы', '​‍⁠'],
      ['только знаки препинания', '...'],
    ])('отклоняет имя: %s — кодом 400, прежнее имя остаётся', async (_title, name) => {
      const { token } = await registerUser()

      await patch(token, { name }).expect(400)

      const res = await me(token).expect(200)
      expect(res.body.name).toBe('Alice')
    })

    it.each([['Иван Петров'], ['Mary-Jane O’Neil'], ['李小龍'], ['Алекс 2'], ['👩‍💻 Ann']])(
      'принимает имя %j',
      async (name) => {
        const { token } = await registerUser()

        const res = await patch(token, { name }).expect(200)

        expect(res.body.name).toBe(name)
      },
    )

    it('принимает имя длиной 100 символов и отклоняет 101', async () => {
      const { token } = await registerUser()

      await patch(token, { name: 'я'.repeat(100) }).expect(200)
      await patch(token, { name: 'я'.repeat(101) }).expect(400)

      const res = await me(token).expect(200)
      expect(res.body.name).toBe('я'.repeat(100))
    })

    it('считает длину имени после обрезки пробелов', async () => {
      const { token } = await registerUser()

      await patch(token, { name: ` ${'я'.repeat(100)} ` }).expect(200)
    })

    it('отклоняет запрос без имени и с именем не строкой кодом 400', async () => {
      const { token } = await registerUser()

      await patch(token, {}).expect(400)
      await patch(token, { name: 123 }).expect(400)
    })

    it('возвращает 401 без токена', async () => {
      await http().patch('/profile').send({ name: 'Bob' }).expect(401)
    })

    it('возвращает 401 с невалидным токеном', async () => {
      await patch('not-a-token', { name: 'Bob' }).expect(401)
    })

    it('меняет только владельца токена', async () => {
      const first = await registerUser('Alice')
      const second = await registerUser('Carol')

      await patch(first.token, { name: 'Bob' }).expect(200)

      expect((await me(first.token).expect(200)).body.name).toBe('Bob')
      expect((await me(second.token).expect(200)).body.name).toBe('Carol')
    })

    it('игнорирует чужой id и прочие поля в теле запроса', async () => {
      const first = await registerUser('Alice')
      const second = await registerUser('Carol')

      const res = await patch(first.token, {
        name: 'Bob',
        id: second.id,
        email: 'hacker@example.com',
        passwordHash: 'x',
      }).expect(200)

      expect(res.body).toEqual({
        id: first.id,
        email: first.email,
        name: 'Bob',
        hasAvatar: false,
        avatarVersion: null,
      })
      expect((await me(second.token).expect(200)).body.name).toBe('Carol')
    })
  })
})
