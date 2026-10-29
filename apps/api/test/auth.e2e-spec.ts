/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- тела ответов supertest не типизированы */
import { createHmac, randomUUID } from 'node:crypto'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { App } from 'supertest/types.js'
import { AppModule } from './../src/app.module.js'

const JWT_SECRET = 'e2e-test-secret'
const PASSWORD = 'Str0ngPassw0rd!'

const base64url = (value: object | Buffer) =>
  Buffer.from(value instanceof Buffer ? value : JSON.stringify(value)).toString('base64url')

function signJwt(payload: object, secret: string) {
  const data = `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(payload)}`
  const signature = createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${signature}`
}

function decodeJwt(token: string) {
  const [header, payload] = token.split('.')
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString()),
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString()),
  }
}

const uniqueEmail = () => `user-${randomUUID()}@example.com`

describe('Auth (e2e)', () => {
  let app: INestApplication<App>

  const http = () => request(app.getHttpServer())
  const register = (body: object) => http().post('/auth/register').send(body)
  const login = (body: object) => http().post('/auth/login').send(body)

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

  describe('POST /auth/register', () => {
    it('регистрирует пользователя и возвращает JWT и публичные данные', async () => {
      const email = uniqueEmail()

      const res = await register({ email, password: PASSWORD, name: 'Alice' }).expect(201)

      expect(res.body.accessToken).toEqual(expect.any(String))
      expect(res.body.user).toEqual({ id: expect.any(String), email, name: 'Alice' })
    })

    it('выпускает валидный HS256 JWT с sub = id пользователя и сроком жизни', async () => {
      const res = await register({
        email: uniqueEmail(),
        password: PASSWORD,
        name: 'Alice',
      }).expect(201)

      const { header, payload } = decodeJwt(res.body.accessToken)
      const expectedSignature = createHmac('sha256', JWT_SECRET)
        .update(res.body.accessToken.split('.').slice(0, 2).join('.'))
        .digest('base64url')

      expect(res.body.accessToken.split('.')).toHaveLength(3)
      expect(res.body.accessToken.split('.')[2]).toBe(expectedSignature)
      expect(header).toMatchObject({ alg: 'HS256', typ: 'JWT' })
      expect(payload.sub).toBe(res.body.user.id)
      expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
      expect(payload.iat).toEqual(expect.any(Number))
    })

    it('не возвращает пароль и его хеш', async () => {
      const res = await register({
        email: uniqueEmail(),
        password: PASSWORD,
        name: 'Alice',
      }).expect(201)

      const serialized = JSON.stringify(res.body)
      expect(serialized).not.toContain(PASSWORD)
      expect(res.body.user).not.toHaveProperty('password')
      expect(res.body.user).not.toHaveProperty('passwordHash')
    })

    it('возвращает 409 при повторной регистрации с тем же email', async () => {
      const email = uniqueEmail()
      await register({ email, password: PASSWORD, name: 'Alice' }).expect(201)

      await register({ email, password: PASSWORD, name: 'Alice 2' }).expect(409)
    })

    it('считает email нечувствительным к регистру', async () => {
      const email = uniqueEmail()
      await register({ email, password: PASSWORD, name: 'Alice' }).expect(201)

      await register({ email: email.toUpperCase(), password: PASSWORD, name: 'Alice' }).expect(409)
    })

    it.each([
      ['email отсутствует', { password: PASSWORD, name: 'Alice' }],
      ['email некорректный', { email: 'not-an-email', password: PASSWORD, name: 'Alice' }],
      ['пароль отсутствует', { email: 'a@example.com', name: 'Alice' }],
      ['пароль слишком короткий', { email: 'a@example.com', password: '123', name: 'Alice' }],
      ['пароль не строка', { email: 'a@example.com', password: 12345678, name: 'Alice' }],
      ['имя отсутствует', { email: 'a@example.com', password: PASSWORD }],
      ['имя пустое', { email: 'a@example.com', password: PASSWORD, name: '' }],
    ])('возвращает 400, если %s', async (_title, body) => {
      await register(body).expect(400)
    })
  })

  describe('POST /auth/login', () => {
    const email = uniqueEmail()

    beforeEach(async () => {
      // пользователь может уже существовать из предыдущего теста — 409 допустим
      const res = await register({ email, password: PASSWORD, name: 'Alice' })
      expect([201, 409]).toContain(res.status)
    })

    it('возвращает JWT и данные пользователя при верных учётных данных', async () => {
      const res = await login({ email, password: PASSWORD }).expect(200)

      expect(res.body.accessToken).toEqual(expect.any(String))
      expect(res.body.user).toEqual({ id: expect.any(String), email, name: 'Alice' })
      expect(decodeJwt(res.body.accessToken).payload.sub).toBe(res.body.user.id)
    })

    it('принимает email в другом регистре', async () => {
      await login({ email: email.toUpperCase(), password: PASSWORD }).expect(200)
    })

    it('возвращает 401 при неверном пароле', async () => {
      const res = await login({ email, password: 'wrong-password' }).expect(401)

      expect(res.body.accessToken).toBeUndefined()
    })

    it('возвращает 401 для несуществующего пользователя', async () => {
      await login({ email: uniqueEmail(), password: PASSWORD }).expect(401)
    })

    it('не раскрывает, существует ли пользователь (одинаковое сообщение об ошибке)', async () => {
      const wrongPassword = await login({ email, password: 'wrong-password' }).expect(401)
      const unknownUser = await login({ email: uniqueEmail(), password: PASSWORD }).expect(401)

      expect(unknownUser.body.message).toBe(wrongPassword.body.message)
    })

    it.each([
      ['email отсутствует', { password: PASSWORD }],
      ['пароль отсутствует', { email: 'a@example.com' }],
      ['email некорректный', { email: 'not-an-email', password: PASSWORD }],
    ])('возвращает 400, если %s', async (_title, body) => {
      await login(body).expect(400)
    })
  })

  describe('GET /auth/me (защищённый маршрут)', () => {
    it('возвращает текущего пользователя по JWT из регистрации', async () => {
      const email = uniqueEmail()
      const { body } = await register({ email, password: PASSWORD, name: 'Alice' }).expect(201)

      const res = await http()
        .get('/auth/me')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(200)

      expect(res.body).toEqual({ id: body.user.id, email, name: 'Alice' })
    })

    it('возвращает текущего пользователя по JWT из логина', async () => {
      const email = uniqueEmail()
      await register({ email, password: PASSWORD, name: 'Alice' }).expect(201)
      const { body } = await login({ email, password: PASSWORD }).expect(200)

      const res = await http()
        .get('/auth/me')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(200)

      expect(res.body.email).toBe(email)
    })

    it('возвращает 401 без заголовка Authorization', async () => {
      await http().get('/auth/me').expect(401)
    })

    it('возвращает 401 при схеме, отличной от Bearer', async () => {
      const { body } = await register({
        email: uniqueEmail(),
        password: PASSWORD,
        name: 'Alice',
      }).expect(201)

      await http().get('/auth/me').set('Authorization', `Basic ${body.accessToken}`).expect(401)
    })

    it('возвращает 401 для мусорного токена', async () => {
      await http().get('/auth/me').set('Authorization', 'Bearer not.a.jwt').expect(401)
    })

    it('возвращает 401 для токена, подписанного чужим секретом', async () => {
      const { body } = await register({
        email: uniqueEmail(),
        password: PASSWORD,
        name: 'Alice',
      }).expect(201)
      const now = Math.floor(Date.now() / 1000)
      const forged = signJwt({ sub: body.user.id, iat: now, exp: now + 3600 }, 'other-secret')

      await http().get('/auth/me').set('Authorization', `Bearer ${forged}`).expect(401)
    })

    it('возвращает 401 для просроченного токена', async () => {
      const { body } = await register({
        email: uniqueEmail(),
        password: PASSWORD,
        name: 'Alice',
      }).expect(201)
      const now = Math.floor(Date.now() / 1000)
      const expired = signJwt({ sub: body.user.id, iat: now - 7200, exp: now - 3600 }, JWT_SECRET)

      await http().get('/auth/me').set('Authorization', `Bearer ${expired}`).expect(401)
    })

    it('возвращает 401 для токена с alg=none', async () => {
      const { body } = await register({
        email: uniqueEmail(),
        password: PASSWORD,
        name: 'Alice',
      }).expect(201)
      const now = Math.floor(Date.now() / 1000)
      const unsigned = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({
        sub: body.user.id,
        iat: now,
        exp: now + 3600,
      })}.`

      await http().get('/auth/me').set('Authorization', `Bearer ${unsigned}`).expect(401)
    })
  })
})
