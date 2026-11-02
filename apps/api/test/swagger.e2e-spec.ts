/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- тела ответов supertest не типизированы */
import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { App } from 'supertest/types.js'
import { AppModule } from './../src/app.module.js'
import { setupSwagger } from './../src/swagger.js'

describe('Swagger (e2e)', () => {
  let app: INestApplication<App>

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    setupSwagger(app)
    await app.init()
  })

  afterEach(async () => {
    await app.close()
  })

  it('GET /docs-json описывает маршруты auth и meetings', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json').expect(200)

    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining([
        '/auth/register',
        '/auth/login',
        '/auth/me',
        '/meetings',
        '/meetings/{id}',
        '/meetings/{meetingId}/files',
        '/meetings/{meetingId}/files/{fileId}',
        '/meetings/{meetingId}/files/{fileId}/download',
      ]),
    )
    expect(res.body.components.securitySchemes).toHaveProperty('bearer')
  })

  it('GET /docs отдаёт Swagger UI', async () => {
    await request(app.getHttpServer()).get('/docs').expect(200)
  })

  it('корневого маршрута больше нет', async () => {
    await request(app.getHttpServer()).get('/').expect(404)
  })
})
