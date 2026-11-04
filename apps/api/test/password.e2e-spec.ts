/* eslint-disable @typescript-eslint/no-unsafe-member-access -- тела ответов supertest не типизированы */
import { randomUUID } from 'node:crypto'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { App } from 'supertest/types.js'
import { AppModule } from './../src/app.module.js'

const PASSWORD = 'Str0ngPassw0rd!'
const NEW_PASSWORD = 'N3wStr0ngPassw0rd!'
const uniqueEmail = () => `user-${randomUUID()}@example.com`

describe('Password (e2e)', () => {
  let app: INestApplication<App>

  const http = () => request(app.getHttpServer())

  const registerUser = async () => {
    const email = uniqueEmail()
    const res = await http()
      .post('/auth/register')
      .send({ email, password: PASSWORD, name: 'Alice' })
    return { email, token: res.body.accessToken as string, id: res.body.user.id as string }
  }

  const changePassword = (token: string, body: object) =>
    http().put('/profile/password').set('Authorization', `Bearer ${token}`).send(body)
  const login = (email: string, password: string) =>
    http().post('/auth/login').send({ email, password })
  const get = (path: string, token: string) =>
    http().get(path).set('Authorization', `Bearer ${token}`)
  const createMeeting = async (token: string) => {
    const res = await http()
      .post('/meetings')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Sync', date: '2030-01-15T10:00:00.000Z', participants: [] })
      .expect(201)
    return res.body.id as string
  }

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

  describe('PUT /profile/password', () => {
    it('меняет пароль: вход работает только с новым', async () => {
      const { email, token } = await registerUser()

      await changePassword(token, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(
        200,
      )

      await login(email, NEW_PASSWORD).expect(200)
      await login(email, PASSWORD).expect(401)
    })

    it('возвращает новый токен, который работает, и не отдаёт passwordHash', async () => {
      const { id, email, token } = await registerUser()

      const res = await changePassword(token, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(200)

      expect(typeof res.body.accessToken).toBe('string')
      expect(res.body.user).toMatchObject({ id, email, name: 'Alice' })
      expect(JSON.stringify(res.body)).not.toContain('passwordHash')
      await get('/auth/me', res.body.accessToken as string).expect(200)
    })

    it('прежний токен получает 401 на эндпоинтах профиля, встреч и файлов', async () => {
      const { token } = await registerUser()
      const meetingId = await createMeeting(token)

      const res = await changePassword(token, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(200)
      const fresh = res.body.accessToken as string

      await get('/auth/me', token).expect(401)
      await http()
        .patch('/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Bob' })
        .expect(401)
      await get('/meetings', token).expect(401)
      await get(`/meetings/${meetingId}`, token).expect(401)
      await get(`/meetings/${meetingId}/files`, token).expect(401)
      await changePassword(token, { currentPassword: NEW_PASSWORD, newPassword: PASSWORD }).expect(
        401,
      )

      await get('/meetings', fresh).expect(200)
      await get(`/meetings/${meetingId}/files`, fresh).expect(200)
    })

    it('прежний токен получает 401 при загрузке файла', async () => {
      const { token } = await registerUser()
      const meetingId = await createMeeting(token)
      await changePassword(token, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(
        200,
      )

      await http()
        .post(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('data'), 'a.txt')
        .expect(401)
    })

    it('отклоняет неверный текущий пароль не кодом 401, пароль не меняется', async () => {
      const { email, token } = await registerUser()

      const res = await changePassword(token, {
        currentPassword: 'wrong-password',
        newPassword: NEW_PASSWORD,
      })

      expect(res.status).toBe(403)
      await login(email, PASSWORD).expect(200)
      await get('/auth/me', token).expect(200)
    })

    it.each([
      ['короче 8 символов', 'Short1!'],
      ['пустой', ''],
    ])('отклоняет новый пароль %s кодом 400', async (_title, newPassword) => {
      const { email, token } = await registerUser()

      await changePassword(token, { currentPassword: PASSWORD, newPassword }).expect(400)

      await login(email, PASSWORD).expect(200)
      await get('/auth/me', token).expect(200)
    })

    it('отклоняет новый пароль, совпадающий с текущим, кодом 400', async () => {
      const { email, token } = await registerUser()

      await changePassword(token, { currentPassword: PASSWORD, newPassword: PASSWORD }).expect(400)

      await login(email, PASSWORD).expect(200)
      await get('/auth/me', token).expect(200)
    })

    it('отклоняет тело без полей кодом 400', async () => {
      const { token } = await registerUser()

      await changePassword(token, {}).expect(400)
    })

    it('требует токен: без него 401', async () => {
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

      await get('/auth/me', bob.token).expect(200)
      await login(bob.email, PASSWORD).expect(200)
    })
  })
})
