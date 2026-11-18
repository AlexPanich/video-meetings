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
  installLlmMock,
  readAllFilesReply,
  SAMPLE_SUMMARY,
  toolResultsText,
  type LlmMock,
} from './support/llm-mock.js'
import {
  heldWhisperReply,
  startWhisperMock,
  transcriptReply,
  whisperErrorReply,
  type WhisperMock,
} from './support/whisper-mock.js'

const PASSWORD = 'Str0ngPassw0rd!'
const TRANSCRIPT = 'Решили перенести демо заказчику на четверг, Алиса готовит стенд.'

const uniqueEmail = () => `user-${randomUUID()}@example.com`

// «аудио» и «видео»: Whisper замокан, содержимое важно только для проверки, что файл дошёл целиком
const AUDIO = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64 * 1024, 7)])
const VIDEO = Buffer.concat([Buffer.from('\0\0\0\x18ftypmp42'), Buffer.alloc(32 * 1024, 3)])

// таймаут теста больше, чем у waitForStatus (10 с): иначе падение по статусу маскируется таймаутом
describe('Transcription for meeting summary (e2e)', { timeout: 20_000 }, () => {
  let app: INestApplication<App>
  let llm: LlmMock
  let whisper: WhisperMock

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
      .send({ title: 'Созвон с заказчиком', date: '2030-01-15T10:00:00.000Z', participants: [] })
      .expect(201)
    return body.id as string
  }

  const upload = async (
    auth: string,
    meetingId: string,
    content: Buffer,
    filename: string,
    contentType: string,
  ): Promise<string> => {
    const { body } = await http()
      .post(`/meetings/${meetingId}/files`)
      .set('Authorization', auth)
      .attach('file', content, { filename, contentType })
      .expect(201)
    return body.id as string
  }

  const meetingWithAudio = async (auth: string) => {
    const meetingId = await createMeeting(auth)
    const audioId = await upload(auth, meetingId, AUDIO, 'call.mp3', 'audio/mpeg')
    return { meetingId, audioId }
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

  const transcripts = (fileId: string) =>
    app.get(PrismaService).meetingTranscript.count({ where: { fileId } })

  beforeAll(async () => {
    process.env.UPLOADS_DIR ??= join(process.cwd(), 'uploads-e2e')
    whisper = await startWhisperMock()
    process.env.WHISPER_URL = whisper.url
    llm = installLlmMock()
    app = await createApp()
  })

  afterAll(async () => {
    await app.close()
    llm.restore()
    await whisper.close()
    delete process.env.WHISPER_URL
  })

  beforeEach(() => {
    llm.setFallback(readAllFilesReply())
    whisper.setFallback(transcriptReply(TRANSCRIPT))
  })

  it('встреча с аудио: pending → transcribing → generating → done, саммари учитывает транскрипт', async () => {
    const auth = await createUser()
    const { meetingId, audioId } = await meetingWithAudio(auth)
    const held = heldWhisperReply(transcriptReply(TRANSCRIPT))
    whisper.enqueue(held.handler)
    const whisperBefore = whisper.requests.length
    const llmBefore = llm.requests.length

    const { body: started } = await start(auth, meetingId).expect(202)
    expect(started).toMatchObject({ meetingId, status: 'pending' })

    await held.called
    await waitForStatus(auth, meetingId, 'transcribing')
    // пока идёт транскрибация, модель не вызывается
    expect(llm.requests.length).toBe(llmBefore)

    held.release()
    const done = await waitForStatus(auth, meetingId, 'done')
    expect(done).toMatchObject({
      status: 'done',
      error: null,
      result: { summary: SAMPLE_SUMMARY.summary, skippedFiles: [] },
    })

    // Whisper получил файл целиком
    const sent = whisper.requests.slice(whisperBefore)
    expect(sent).toHaveLength(1)
    expect(sent[0].file?.equals(AUDIO)).toBe(true)
    expect(sent[0].mimeType).toBe('audio/mpeg')

    // модель прочитала транскрипт через инструменты, а не байты аудио
    const seen = toolResultsText(llm.requests.slice(llmBefore))
    expect(seen).toContain(audioId)
    expect(seen).toContain(TRANSCRIPT)
    expect(await transcripts(audioId)).toBe(1)
  })

  it('видео тоже транскрибируется и вместе с текстом становится источником', async () => {
    const auth = await createUser()
    const meetingId = await createMeeting(auth)
    await upload(auth, meetingId, Buffer.from('Повестка: демо.'), 'agenda.txt', 'text/plain')
    const videoId = await upload(auth, meetingId, VIDEO, 'call.mp4', 'video/mp4')
    const whisperBefore = whisper.requests.length
    const llmBefore = llm.requests.length

    await start(auth, meetingId).expect(202)
    const done = await waitForStatus(auth, meetingId, 'done')

    expect(done.result).toMatchObject({ skippedFiles: [] })
    const sent = whisper.requests.slice(whisperBefore)
    expect(sent).toHaveLength(1)
    expect(sent[0].file?.equals(VIDEO)).toBe(true)
    const seen = toolResultsText(llm.requests.slice(llmBefore))
    expect(seen).toContain(videoId)
    expect(seen).toContain(TRANSCRIPT)
    expect(seen).toContain('Повестка: демо.')
  })

  it('повторный запуск не транскрибирует неизменённый файл, транскрипт берётся сохранённый', async () => {
    const auth = await createUser()
    const { meetingId } = await meetingWithAudio(auth)
    await start(auth, meetingId).expect(202)
    await waitForStatus(auth, meetingId, 'done')
    const whisperBefore = whisper.requests.length
    const llmBefore = llm.requests.length
    // если бы файл транскрибировался снова, задача упала бы
    whisper.setFallback(whisperErrorReply(500))

    await start(auth, meetingId).expect(202)
    const done = await waitForStatus(auth, meetingId, 'done')

    expect(done.error).toBeNull()
    expect(whisper.requests.length).toBe(whisperBefore)
    expect(toolResultsText(llm.requests.slice(llmBefore))).toContain(TRANSCRIPT)
  })

  it('новый файл встречи транскрибируется, уже готовые — нет', async () => {
    const auth = await createUser()
    const { meetingId } = await meetingWithAudio(auth)
    await start(auth, meetingId).expect(202)
    await waitForStatus(auth, meetingId, 'done')
    await upload(auth, meetingId, VIDEO, 'part-2.mp4', 'video/mp4')
    const whisperBefore = whisper.requests.length

    await start(auth, meetingId).expect(202)
    await waitForStatus(auth, meetingId, 'done')

    const sent = whisper.requests.slice(whisperBefore)
    expect(sent).toHaveLength(1)
    expect(sent[0].file?.equals(VIDEO)).toBe(true)
  })

  it('недоступный Whisper → failed с причиной, повтор успешен', async () => {
    const auth = await createUser()
    const { meetingId } = await meetingWithAudio(auth)
    whisper.setFallback(whisperErrorReply(503, 'CUDA out of memory'))
    const llmBefore = llm.requests.length

    await start(auth, meetingId).expect(202)
    const failed = await waitForStatus(auth, meetingId, 'failed')
    expect(String(failed.error)).toMatch(/транскриб/i)
    // причина для владельца — без адреса и ответа сервиса
    expect(String(failed.error)).not.toContain(whisper.url)
    expect(String(failed.error)).not.toContain('CUDA')
    expect(failed.result).toBeNull()
    // без транскрипта модель не вызывалась
    expect(llm.requests.length).toBe(llmBefore)

    whisper.setFallback(transcriptReply(TRANSCRIPT))
    await start(auth, meetingId).expect(202)
    const done = await waitForStatus(auth, meetingId, 'done')
    expect(done.error).toBeNull()
    expect(done.result).toMatchObject({ summary: SAMPLE_SUMMARY.summary })
  })

  it('файл, который Whisper отклонил (4xx), — в skippedFiles, саммари по остальным', async () => {
    const auth = await createUser()
    const meetingId = await createMeeting(auth)
    await upload(auth, meetingId, Buffer.from('Повестка: демо.'), 'agenda.txt', 'text/plain')
    const videoId = await upload(auth, meetingId, VIDEO, 'screen.mp4', 'video/mp4')
    // видео без звуковой дорожки: whisper-server отвечает 400
    whisper.setFallback(whisperErrorReply(400, 'no audio stream'))

    await start(auth, meetingId).expect(202)
    const done = await waitForStatus(auth, meetingId, 'done')

    expect(done.error).toBeNull()
    expect(done.result).toMatchObject({ skippedFiles: [{ id: videoId, name: 'screen.mp4' }] })
    expect(await transcripts(videoId)).toBe(0)
  })

  it('удаление встречи удаляет транскрипты', async () => {
    const auth = await createUser()
    const { meetingId, audioId } = await meetingWithAudio(auth)
    await start(auth, meetingId).expect(202)
    await waitForStatus(auth, meetingId, 'done')
    expect(await transcripts(audioId)).toBe(1)

    await http().delete(`/meetings/${meetingId}`).set('Authorization', auth).expect(204)

    expect(await transcripts(audioId)).toBe(0)
  })

  it('удаление встречи во время транскрибации обрывает запрос к Whisper, транскрипт не пишется', async () => {
    const auth = await createUser()
    const { meetingId, audioId } = await meetingWithAudio(auth)
    const held = heldWhisperReply(transcriptReply(TRANSCRIPT))
    whisper.enqueue(held.handler)

    await start(auth, meetingId).expect(202)
    await held.called
    await http().delete(`/meetings/${meetingId}`).set('Authorization', auth).expect(204)

    await held.aborted
    held.release()
    expect(await transcripts(audioId)).toBe(0)
  })

  it('удаление файла удаляет его транскрипт', async () => {
    const auth = await createUser()
    const { meetingId, audioId } = await meetingWithAudio(auth)
    await start(auth, meetingId).expect(202)
    await waitForStatus(auth, meetingId, 'done')

    await http()
      .delete(`/meetings/${meetingId}/files/${audioId}`)
      .set('Authorization', auth)
      .expect(204)

    expect(await transcripts(audioId)).toBe(0)
  })
})

const createApp = async () => {
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile()
  const app = moduleFixture.createNestApplication<INestApplication<App>>()
  await app.init()
  return app
}
