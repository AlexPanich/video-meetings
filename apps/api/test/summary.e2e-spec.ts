/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- тела ответов supertest не типизированы */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { App } from 'supertest/types.js'
import { AppModule } from './../src/app.module.js'
import { PrismaService } from './../src/prisma/prisma.service.js'
import {
  heldReply,
  httpErrorReply,
  installLlmMock,
  SAMPLE_SUMMARY,
  summaryReply,
  type LlmMock,
} from './support/llm-mock.js'

const PASSWORD = 'Str0ngPassw0rd!'

const uniqueEmail = () => `user-${randomUUID()}@example.com`

const OTHER_SUMMARY = {
  summary: 'Пересобранное саммари.',
  decisions: ['Перенести релиз на понедельник'],
  actionItems: [{ task: 'Сообщить заказчику', assignee: 'Боб' }],
  openQuestions: [],
}

const createApp = async () => {
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile()
  const app = moduleFixture.createNestApplication<INestApplication<App>>()
  await app.init()
  return app
}

describe('Meeting summary (e2e)', () => {
  let app: INestApplication<App>
  let llm: LlmMock

  const http = () => request(app.getHttpServer())

  const createUser = async () => {
    const { body } = await http()
      .post('/auth/register')
      .send({ email: uniqueEmail(), password: PASSWORD, name: 'Alice' })
      .expect(201)
    return `Bearer ${body.accessToken}`
  }

  const createMeeting = async (auth: string): Promise<string> => {
    const { body } = await http()
      .post('/meetings')
      .set('Authorization', auth)
      .send({ title: 'Планёрка', date: '2030-01-15T10:00:00.000Z', participants: [] })
      .expect(201)
    return body.id as string
  }

  const upload = async (
    auth: string,
    meetingId: string,
    content: string,
    filename: string,
    contentType = 'text/plain',
  ): Promise<string> => {
    const { body } = await http()
      .post(`/meetings/${meetingId}/files`)
      .set('Authorization', auth)
      .attach('file', Buffer.from(content), { filename, contentType })
      .expect(201)
    return body.id as string
  }

  // встреча с текстовым файлом — минимальный набор для саммари
  const meetingWithNotes = async (auth: string) => {
    const meetingId = await createMeeting(auth)
    await upload(auth, meetingId, 'Обсудили релиз 2.0, выпускаем в пятницу.', 'notes.txt')
    return meetingId
  }

  const start = (auth: string, meetingId: string) =>
    http().post(`/meetings/${meetingId}/summary`).set('Authorization', auth)

  const get = (auth: string, meetingId: string) =>
    http().get(`/meetings/${meetingId}/summary`).set('Authorization', auth)

  const waitForStatus = async (auth: string, meetingId: string, status: string) => {
    let body: Record<string, unknown> = {}
    await vi.waitFor(
      async () => {
        const response = await get(auth, meetingId).expect(200)
        body = response.body as Record<string, unknown>
        expect(body.status).toBe(status)
      },
      { timeout: 10_000, interval: 50 },
    )
    return body
  }

  beforeAll(async () => {
    process.env.UPLOADS_DIR ??= join(process.cwd(), 'uploads-e2e')
    llm = installLlmMock()
    app = await createApp()
  })

  afterAll(async () => {
    await app.close()
    llm.restore()
  })

  beforeEach(() => {
    llm.setFallback(summaryReply())
  })

  describe('POST /meetings/:id/summary', () => {
    it('запускает задачу: pending → generating → done с результатом и неучтёнными файлами', async () => {
      const auth = await createUser()
      const meetingId = await createMeeting(auth)
      await upload(auth, meetingId, 'Обсудили релиз 2.0, выпускаем в пятницу.', 'notes.txt')
      await upload(auth, meetingId, '# Повестка\n- релиз', 'agenda.md', 'text/markdown')
      const photoId = await upload(auth, meetingId, 'not really a png', 'photo.png', 'image/png')
      const held = heldReply()
      llm.enqueue(held.handler)

      const { body: started } = await start(auth, meetingId).expect(202)
      expect(started).toMatchObject({ meetingId, status: 'pending' })

      await held.called
      await waitForStatus(auth, meetingId, 'generating')

      held.release()
      const done = await waitForStatus(auth, meetingId, 'done')
      expect(done).toMatchObject({
        meetingId,
        status: 'done',
        error: null,
        result: {
          summary: SAMPLE_SUMMARY.summary,
          decisions: SAMPLE_SUMMARY.decisions,
          actionItems: SAMPLE_SUMMARY.actionItems,
          openQuestions: SAMPLE_SUMMARY.openQuestions,
          skippedFiles: [{ id: photoId, name: 'photo.png' }],
        },
      })
    })

    it('409, пока задача активна', async () => {
      const auth = await createUser()
      const meetingId = await meetingWithNotes(auth)
      const held = heldReply()
      llm.enqueue(held.handler)

      await start(auth, meetingId).expect(202)
      await held.called
      await start(auth, meetingId).expect(409)

      held.release()
      await waitForStatus(auth, meetingId, 'done')
    })

    it('пересоздание заменяет старое саммари только после успеха', async () => {
      const auth = await createUser()
      const meetingId = await meetingWithNotes(auth)
      await start(auth, meetingId).expect(202)
      await waitForStatus(auth, meetingId, 'done')

      // пересоздание идёт — старый результат на месте
      const held = heldReply(httpErrorReply(500))
      llm.enqueue(held.handler)
      await start(auth, meetingId).expect(202)
      await held.called
      const generating = await waitForStatus(auth, meetingId, 'generating')
      expect(generating.result).toMatchObject({ summary: SAMPLE_SUMMARY.summary })

      // пересоздание упало — старый результат по-прежнему на месте
      held.release()
      const failed = await waitForStatus(auth, meetingId, 'failed')
      expect(failed.result).toMatchObject({ summary: SAMPLE_SUMMARY.summary })

      // успешное пересоздание заменяет результат
      llm.setFallback(summaryReply(OTHER_SUMMARY))
      await start(auth, meetingId).expect(202)
      const done = await waitForStatus(auth, meetingId, 'done')
      expect(done.result).toMatchObject(OTHER_SUMMARY)
      expect(done.error).toBeNull()
    })

    it('ошибка LLM → failed с причиной, повтор успешен', async () => {
      const auth = await createUser()
      const meetingId = await meetingWithNotes(auth)
      llm.setFallback(httpErrorReply(500, 'model crashed'))

      await start(auth, meetingId).expect(202)
      const failed = await waitForStatus(auth, meetingId, 'failed')
      expect(failed.error).toEqual(expect.any(String))
      expect(String(failed.error).length).toBeGreaterThan(0)
      expect(failed.result).toBeNull()

      llm.setFallback(summaryReply())
      await start(auth, meetingId).expect(202)
      const done = await waitForStatus(auth, meetingId, 'done')
      expect(done.error).toBeNull()
      expect(done.result).toMatchObject({ summary: SAMPLE_SUMMARY.summary })
    })

    it('401 без токена', async () => {
      const auth = await createUser()
      const meetingId = await meetingWithNotes(auth)

      await http().post(`/meetings/${meetingId}/summary`).expect(401)
    })

    it('404 для чужой и несуществующей встречи', async () => {
      const owner = await createUser()
      const stranger = await createUser()
      const meetingId = await meetingWithNotes(owner)

      await start(stranger, meetingId).expect(404)
      await start(owner, randomUUID()).expect(404)
      // чужой запуск не создал задачу
      await get(owner, meetingId).expect(404)
    })
  })

  describe('GET /meetings/:id/summary', () => {
    it('401 без токена', async () => {
      const auth = await createUser()
      const meetingId = await meetingWithNotes(auth)

      await http().get(`/meetings/${meetingId}/summary`).expect(401)
    })

    it('404, если саммари ещё не запускали', async () => {
      const auth = await createUser()
      const meetingId = await meetingWithNotes(auth)

      await get(auth, meetingId).expect(404)
    })

    it('404 для чужой встречи', async () => {
      const owner = await createUser()
      const stranger = await createUser()
      const meetingId = await meetingWithNotes(owner)
      await start(owner, meetingId).expect(202)
      await waitForStatus(owner, meetingId, 'done')

      await get(stranger, meetingId).expect(404)
    })
  })

  it('удаление встречи удаляет саммари', async () => {
    const auth = await createUser()
    const meetingId = await meetingWithNotes(auth)
    await start(auth, meetingId).expect(202)
    await waitForStatus(auth, meetingId, 'done')

    await http().delete(`/meetings/${meetingId}`).set('Authorization', auth).expect(204)

    const prisma = app.get(PrismaService)
    expect(await prisma.meetingSummary.findUnique({ where: { meetingId } })).toBeNull()
  })

  it('после рестарта api зависшая задача помечается failed, прежний результат остаётся', async () => {
    const auth = await createUser()
    const meetingId = await meetingWithNotes(auth)
    await start(auth, meetingId).expect(202)
    await waitForStatus(auth, meetingId, 'done')
    // процесс «упал» посреди пересоздания
    const prisma = app.get(PrismaService)
    await prisma.meetingSummary.update({ where: { meetingId }, data: { status: 'generating' } })

    const restarted = await createApp()
    try {
      const { body } = await request(restarted.getHttpServer())
        .get(`/meetings/${meetingId}/summary`)
        .set('Authorization', auth)
        .expect(200)
      expect(body.status).toBe('failed')
      expect(body.error).toEqual(expect.any(String))
      expect(body.result).toMatchObject({ summary: SAMPLE_SUMMARY.summary })
    } finally {
      await restarted.close()
    }
  })
})
