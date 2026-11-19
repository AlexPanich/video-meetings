/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- тела ответов supertest не типизированы */
import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { App } from 'supertest/types.js'
import { AppModule } from './../src/app.module.js'
import { setupSwagger } from './../src/swagger.js'
import { NAME_ALLOWED_SCHEMA_PATTERN } from './../src/users/user-name.js'

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

  it('GET /docs-json описывает PATCH /profile и схему его ответа', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json').expect(200)

    const operation = res.body.paths['/profile']?.patch
    expect(operation).toBeDefined()
    expect(operation.responses['200'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/PublicUserDto',
    )
    expect(res.body.components.schemas).toHaveProperty('PublicUserDto')
  })

  it('GET /docs-json описывает ограничения POST /meetings и ответ 400', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json').expect(200)

    const operation = res.body.paths['/meetings']?.post
    expect(operation).toBeDefined()
    expect(operation.requestBody.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/CreateMeetingDto',
    )
    expect(operation.responses['400'].description).toMatch(/назван/i)
    expect(operation.responses).toHaveProperty('401')

    const schema = res.body.components.schemas.CreateMeetingDto
    expect(schema.required).toEqual(expect.arrayContaining(['title', 'date', 'participants']))
    // в OpenAPI у pattern нет флага `u`: шаблон должен работать без него
    expect(schema.properties.title).toMatchObject({
      type: 'string',
      minLength: 1,
      maxLength: 200,
      pattern: NAME_ALLOWED_SCHEMA_PATTERN,
    })
    expect(schema.properties.date).toMatchObject({ type: 'string', pattern: expect.any(String) })
    expect(new RegExp(schema.properties.date.pattern).test('2030-01-15T10:00:00Z')).toBe(true)
    expect(new RegExp(schema.properties.date.pattern).test('2030-01-15T10:00:00z')).toBe(false)
    expect(schema.properties.participants).toMatchObject({
      type: 'array',
      maxItems: 50,
      items: { type: 'string', minLength: 1, maxLength: 100, pattern: NAME_ALLOWED_SCHEMA_PATTERN },
    })
    expect(schema.properties.participants).not.toHaveProperty('maxLength')
  })

  it('GET /docs отдаёт Swagger UI', async () => {
    await request(app.getHttpServer()).get('/docs').expect(200)
  })

  it('корневого маршрута больше нет', async () => {
    await request(app.getHttpServer()).get('/').expect(404)
  })
})
