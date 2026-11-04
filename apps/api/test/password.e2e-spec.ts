/* eslint-disable @typescript-eslint/no-unsafe-member-access -- тела ответов supertest не типизированы */
import { randomUUID } from 'node:crypto'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { App } from 'supertest/types.js'
import { AppModule } from './../src/app.module.js'

const PASSWORD = 'Str0ngPassw0rd!'
const NEW_PASSWORD = 'An0therPassw0rd!'
const uniqueEmail = () => `user-${randomUUID()}@example.com`

describe('PUT /profile/password (e2e)', () => {
  let app: INestApplication<App>

  const http = () => request(app.getHttpServer())
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

  const registerUser = async () => {
    const email = uniqueEmail()
    const res = await http()
      .post('/auth/register')
      .send({ email, password: PASSWORD, name: 'Alice' })
    return { email, token: res.body.accessToken as string, id: res.body.user.id as string }
  }

  const changePassword = (token: string, body: object) =>
    http().put('/profile/password').set(bearer(token)).send(body)
  const login = (email: string, password: string) =>
    http().post('/auth/login').send({ email, password })

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

  it('меняет пароль: вход работает только с новым паролем', async () => {
    const { email, token } = await registerUser()

    await changePassword(token, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(
      200,
    )

    await login(email, NEW_PASSWORD).expect(200)
    await login(email, PASSWORD).expect(401)
  })

  it('возвращает новый токен и публичные данные без passwordHash', async () => {
    const { email, token, id } = await registerUser()

    const res = await changePassword(token, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    }).expect(200)

    expect(typeof res.body.accessToken).toBe('string')
    expect(res.body.accessToken).not.toBe(token)
    expect(res.body.user).toMatchObject({ id, email, name: 'Alice' })
    expect(res.body.user).not.toHaveProperty('passwordHash')
    expect(JSON.stringify(res.body)).not.toContain('passwordHash')
  })

  it('прежний токен получает 401 на эндпоинтах профиля, встреч и файлов, новый работает', async () => {
    const { token } = await registerUser()
    const meeting = await http()
      .post('/meetings')
      .set(bearer(token))
      .send({ title: 'Planning', date: '2030-01-01T10:00:00.000Z', participants: [] })
      .expect(201)
    const meetingId = meeting.body.id as string

    const res = await changePassword(token, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    }).expect(200)
    const fresh = res.body.accessToken as string

    await http().get('/auth/me').set(bearer(token)).expect(401)
    await http().patch('/profile').set(bearer(token)).send({ name: 'Bob' }).expect(401)
    await http().get('/profile/avatar').set(bearer(token)).expect(401)
    await http().get('/meetings').set(bearer(token)).expect(401)
    await http().get(`/meetings/${meetingId}`).set(bearer(token)).expect(401)
    await http().get(`/meetings/${meetingId}/files`).set(bearer(token)).expect(401)
    await http()
      .post(`/meetings/${meetingId}/files`)
      .set(bearer(token))
      .attach('file', Buffer.from('data'), 'a.txt')
      .expect(401)
    await changePassword(token, {
      currentPassword: NEW_PASSWORD,
      newPassword: 'Third0Passw0rd!',
    }).expect(401)

    await http().get('/auth/me').set(bearer(fresh)).expect(200)
    await http().get(`/meetings/${meetingId}`).set(bearer(fresh)).expect(200)
  })

  it('отказывает при неверном текущем пароле (не 401) и не меняет пароль', async () => {
    const { email, token } = await registerUser()

    const res = await changePassword(token, {
      currentPassword: 'WrongPassw0rd!',
      newPassword: NEW_PASSWORD,
    })

    expect(res.status).toBe(400)
    await login(email, PASSWORD).expect(200)
    await http().get('/auth/me').set(bearer(token)).expect(200)
  })

  it.each([
    ['новый пароль короче 8 символов', { currentPassword: PASSWORD, newPassword: 'short1!' }],
    ['новый пароль совпадает с текущим', { currentPassword: PASSWORD, newPassword: PASSWORD }],
    ['нет текущего пароля', { newPassword: NEW_PASSWORD }],
    ['нет нового пароля', { currentPassword: PASSWORD }],
    ['пароли не строки', { currentPassword: 1, newPassword: 2 }],
  ])('%s — 400, пароль и токен не меняются', async (_title, body) => {
    const { email, token } = await registerUser()

    await changePassword(token, body).expect(400)

    await login(email, PASSWORD).expect(200)
    await http().get('/auth/me').set(bearer(token)).expect(200)
  })

  it('без токена отвечает 401', async () => {
    await http()
      .put('/profile/password')
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(401)
  })

  it('не затрагивает других пользователей', async () => {
    const alice = await registerUser()
    const bob = await registerUser()

    await changePassword(alice.token, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    }).expect(200)

    await http().get('/auth/me').set(bearer(bob.token)).expect(200)
    await login(bob.email, PASSWORD).expect(200)
  })
})
