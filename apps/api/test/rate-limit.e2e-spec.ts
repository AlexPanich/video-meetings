/* eslint-disable @typescript-eslint/no-unsafe-member-access -- тела ответов supertest не типизированы */
import { randomUUID } from 'node:crypto'
import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { App } from 'supertest/types.js'
import { AppModule } from './../src/app.module.js'

const PASSWORD = 'Str0ngPassw0rd!'
const WRONG = 'WrongPassw0rd!'
const uniqueEmail = () => `user-${randomUUID()}@example.com`

// Лимит 3: четвёртый запрос блокируется. Приложение создаётся на каждый тест, поэтому счётчики
// (в памяти процесса) не пересекаются, а `trust proxy` включён, как за BFF: IP клиента задаётся
// заголовком X-Forwarded-For, и по нему видно, какой именно лимит сработал.
describe('Rate limiting (e2e)', () => {
  let app: INestApplication<App>
  const saved = { limit: process.env.AUTH_RATE_LIMIT, jwt: process.env.JWT_SECRET }

  beforeEach(async () => {
    process.env.AUTH_RATE_LIMIT = '3'
    process.env.JWT_SECRET = 'e2e-test-secret-at-least-32-bytes-long'
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile()
    const nest = moduleFixture.createNestApplication<NestExpressApplication>()
    nest.set('trust proxy', 1)
    app = nest
    await app.init()
  })

  afterEach(async () => {
    if (saved.limit === undefined) delete process.env.AUTH_RATE_LIMIT
    else process.env.AUTH_RATE_LIMIT = saved.limit
    if (saved.jwt === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = saved.jwt
    await app.close()
  })

  const http = () => request(app.getHttpServer())
  const login = (email: string, ip: string, password = WRONG) =>
    http().post('/auth/login').set('X-Forwarded-For', ip).send({ email, password })
  const register = async (email = uniqueEmail(), ip = '10.0.0.1') => {
    const res = await http()
      .post('/auth/register')
      .set('X-Forwarded-For', ip)
      .send({ email, password: PASSWORD, name: 'Alice' })
      .expect(201)
    return { email, token: res.body.accessToken as string }
  }
  const statuses = async (calls: Array<() => Promise<{ status: number }>>) => {
    const result: number[] = []
    for (const call of calls) result.push((await call()).status)
    return result
  }

  describe('login', () => {
    it('одна пара email+IP: 4-я неудача → 429 с Retry-After и русским сообщением', async () => {
      const email = uniqueEmail()
      await register(email, '10.0.0.9')

      const results = await statuses(Array.from({ length: 3 }, () => () => login(email, '1.1.1.1')))
      const blocked = await login(email, '1.1.1.1', PASSWORD)

      expect(results).toEqual([401, 401, 401])
      // даже верный пароль не пропускается, пока пара заблокирована
      expect(blocked.status).toBe(429)
      expect(blocked.body.message).toBe('Слишком много попыток, повторите позже')
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
    })

    it('чужие неудачные попытки с другого IP не мешают владельцу войти', async () => {
      const email = uniqueEmail()
      await register(email, '10.0.0.9')
      await statuses(Array.from({ length: 4 }, () => () => login(email, '6.6.6.6')))

      const owner = await login(email, '1.1.1.1', PASSWORD)

      expect(owner.status).toBe(200)
    })

    it('регистр email не важен', async () => {
      const email = uniqueEmail()
      const results = await statuses(
        [email, email.toUpperCase(), email, email.toUpperCase()].map(
          (e) => () => login(e, '1.1.1.1'),
        ),
      )

      expect(results).toEqual([401, 401, 401, 429])
    })

    it('распределённый перебор одного email с разных IP закрывает вход всем', async () => {
      const email = uniqueEmail()
      const results = await statuses(
        Array.from({ length: 9 }, (_, i) => () => login(email, `7.7.7.${i + 1}`)),
      )
      expect(results).toEqual(Array(9).fill(401))

      const blocked = await login(email, '8.8.8.8', PASSWORD)

      expect(blocked.status).toBe(429)
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
    })

    it('лимит ip: один IP с разными email, другой IP не затронут', async () => {
      const results = await statuses(
        Array.from({ length: 4 }, () => () => login(uniqueEmail(), '5.5.5.5')),
      )
      expect(results).toEqual([401, 401, 401, 429])

      const other = await login(uniqueEmail(), '5.5.5.6')

      expect(other.status).toBe(401)
    })

    it('адреса одной IPv6-подсети /64 делят лимит ip', async () => {
      const results = await statuses(
        ['2001:db8:1:2::1', '2001:db8:1:2::2', '2001:db8:1:2::3', '2001:db8:1:2::4'].map(
          (ip) => () => login(uniqueEmail(), ip),
        ),
      )

      expect(results).toEqual([401, 401, 401, 429])
    })
  })

  it('register: лимит ip, Retry-After и русское сообщение', async () => {
    const results: Array<{ status: number; body: { message?: string }; retry?: string }> = []
    for (let i = 0; i < 4; i++) {
      const r = await http()
        .post('/auth/register')
        .set('X-Forwarded-For', '4.4.4.4')
        .send({ email: uniqueEmail(), password: PASSWORD, name: 'Bob' })
      results.push({
        status: r.status,
        body: r.body as { message?: string },
        retry: r.headers['retry-after'],
      })
    }

    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 429])
    expect(results[3].body.message).toBe('Слишком много попыток, повторите позже')
    expect(Number(results[3].retry)).toBeGreaterThan(0)
  })

  describe('PUT /profile/password', () => {
    const change = (token: string, ip: string) =>
      http()
        .put('/profile/password')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Forwarded-For', ip)
        .send({ currentPassword: WRONG, newPassword: 'N3wStr0ngPassw0rd!' })

    it('лимит по пользователю: с разных IP 4-я попытка → 429 (срабатывает account, не ip)', async () => {
      const { token } = await register()

      const results = await statuses(
        ['3.3.3.1', '3.3.3.2', '3.3.3.3', '3.3.3.4'].map((ip) => () => change(token, ip)),
      )

      expect(results).toEqual([403, 403, 403, 429])
    })

    it('лимит по IP: разные пользователи с одного IP, другой IP не затронут', async () => {
      const tokens = [
        (await register(uniqueEmail(), '10.0.1.1')).token,
        (await register(uniqueEmail(), '10.0.1.2')).token,
        (await register(uniqueEmail(), '10.0.1.3')).token,
        (await register(uniqueEmail(), '10.0.1.4')).token,
      ]
      // регистрации выше сделаны с разных IP, чтобы не упереться в лимит регистрации

      const results = await statuses(tokens.map((t) => () => change(t, '3.3.3.9')))
      expect(results).toEqual([403, 403, 403, 429])

      expect((await change(tokens[0], '3.3.3.10')).status).toBe(403)
    })
  })

  describe('TRUST_PROXY выключен', () => {
    it('поддельный X-Forwarded-For игнорируется: лимит считается по адресу сокета', async () => {
      await app.close()
      const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile()
      const nest = moduleFixture.createNestApplication<NestExpressApplication>()
      nest.set('trust proxy', false)
      app = nest
      await app.init()

      const results = await statuses(
        Array.from({ length: 4 }, (_, i) => () => login(uniqueEmail(), `9.9.9.${i + 1}`)),
      )

      expect(results).toEqual([401, 401, 401, 429])
    })
  })

  it('прочие эндпоинты лимитом не затронуты', async () => {
    for (let i = 0; i < 5; i++) {
      await http().get('/auth/me').expect(401)
    }
  })
})
