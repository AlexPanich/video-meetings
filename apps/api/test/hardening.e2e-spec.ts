/* eslint-disable @typescript-eslint/no-unsafe-member-access -- тела ответов supertest не типизированы */
import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { App } from 'supertest/types.js'
import { AppModule } from './../src/app.module.js'
import { setupSecurity } from './../src/security.js'
import { setupSwagger } from './../src/swagger.js'

const PASSWORD = 'Str0ngPassw0rd!'

describe('Hardening (e2e)', () => {
  let app: INestApplication<App>

  const http = () => request(app.getHttpServer())

  const createApp = async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = moduleFixture.createNestApplication()
    setupSecurity(app)
    setupSwagger(app)
    await app.init()
  }

  const registerUser = async () => {
    const email = `user-${randomUUID()}@example.com`
    const res = await http()
      .post('/auth/register')
      .send({ email, password: PASSWORD, name: 'Alice' })
      .expect(201)
    return { email, token: res.body.accessToken as string }
  }

  afterEach(async () => {
    await app.close()
  })

  describe('POST /auth/logout', () => {
    beforeEach(createApp)

    it('отзывает все токены пользователя, вход заново работает', async () => {
      const { email, token } = await registerUser()
      const second = await http().post('/auth/login').send({ email, password: PASSWORD })
      const secondToken = second.body.accessToken as string

      await http().post('/auth/logout').set('Authorization', `Bearer ${token}`).expect(204)

      await http().get('/auth/me').set('Authorization', `Bearer ${token}`).expect(401)
      await http().get('/auth/me').set('Authorization', `Bearer ${secondToken}`).expect(401)

      const again = await http().post('/auth/login').send({ email, password: PASSWORD })
      expect(again.status).toBe(200)
      await http()
        .get('/auth/me')
        .set('Authorization', `Bearer ${again.body.accessToken as string}`)
        .expect(200)
    })

    it('без токена — 401', async () => {
      await http().post('/auth/logout').expect(401)
    })
  })

  describe('LoginDto', () => {
    beforeEach(createApp)

    it('пароль длиннее 1024 символов — 400', async () => {
      await http()
        .post('/auth/login')
        .send({ email: 'a@example.com', password: 'x'.repeat(1025) })
        .expect(400)
    })
  })

  describe('заголовки', () => {
    beforeEach(createApp)

    it('нет X-Powered-By, есть заголовки helmet', async () => {
      const res = await http().get('/auth/me')
      expect(res.headers['x-powered-by']).toBeUndefined()
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.headers['strict-transport-security']).toBeDefined()
    })

    it('Swagger UI по-прежнему открывается', async () => {
      await http().get('/docs').expect(200)
    })
  })

  describe('Swagger в production', () => {
    const previous = process.env.NODE_ENV

    beforeEach(async () => {
      process.env.NODE_ENV = 'production'
      await createApp()
    })

    afterEach(() => {
      process.env.NODE_ENV = previous
    })

    it('/docs и /docs-json недоступны', async () => {
      await http().get('/docs').expect(404)
      await http().get('/docs-json').expect(404)
    })
  })
})
