/* eslint-disable @typescript-eslint/no-unsafe-member-access -- тела ответов supertest не типизированы */
import { randomUUID } from 'node:crypto'
import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { App } from 'supertest/types.js'
import { AppModule } from './../src/app.module.js'

const PASSWORD = 'Str0ngPassw0rd!'
const uniqueEmail = () => `user-${randomUUID()}@example.com`

describe('Rate limiting (e2e)', () => {
  let app: INestApplication<App>
  const previous = process.env.AUTH_RATE_LIMIT

  beforeAll(async () => {
    process.env.AUTH_RATE_LIMIT = '3'
    process.env.JWT_SECRET = 'e2e-test-secret-at-least-32-bytes-long'
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleFixture.createNestApplication()
    await app.init()
  })

  afterAll(async () => {
    if (previous === undefined) delete process.env.AUTH_RATE_LIMIT
    else process.env.AUTH_RATE_LIMIT = previous
    await app.close()
  })

  const http = () => request(app.getHttpServer())

  it('PUT /profile/password: перебор текущего пароля ограничен → 429', async () => {
    const res = await http()
      .post('/auth/register')
      .send({ email: uniqueEmail(), password: PASSWORD, name: 'Alice' })
      .expect(201)
    const token = res.body.accessToken as string

    const statuses: number[] = []
    for (let i = 0; i < 4; i++) {
      const r = await http()
        .put('/profile/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'WrongPassw0rd!', newPassword: 'N3wStr0ngPassw0rd!' })
      statuses.push(r.status)
    }
    expect(statuses).toEqual([403, 403, 403, 429])
  })

  it('login: 4-й запрос по одному email → 429', async () => {
    const email = uniqueEmail()
    const statuses: number[] = []
    for (let i = 0; i < 4; i++) {
      const r = await http().post('/auth/login').send({ email, password: 'WrongPassw0rd!' })
      statuses.push(r.status)
    }
    expect(statuses).toEqual([401, 401, 401, 429])
  })

  it('login: лимит по email не зависит от регистра', async () => {
    const email = uniqueEmail()
    const statuses: number[] = []
    for (const e of [email, email.toUpperCase(), email, email.toUpperCase()]) {
      const r = await http().post('/auth/login').send({ email: e, password: 'WrongPassw0rd!' })
      statuses.push(r.status)
    }
    expect(statuses.at(-1)).toBe(429)
  })

  it('register: лимит по IP срабатывает при разных email', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 4; i++) {
      const r = await http()
        .post('/auth/register')
        .send({ email: uniqueEmail(), password: PASSWORD, name: 'Bob' })
      statuses.push(r.status)
    }
    expect(statuses.at(-1)).toBe(429)
  })

  it('прочие эндпоинты лимитом не затронуты', async () => {
    for (let i = 0; i < 5; i++) {
      await http().get('/auth/me').expect(401)
    }
  })
})
