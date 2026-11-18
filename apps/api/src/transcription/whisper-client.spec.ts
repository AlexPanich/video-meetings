import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import {
  silentReply,
  startWhisperMock,
  transcriptReply,
  TRANSCRIPTIONS_PATH,
  whisperCppResponse,
  whisperErrorReply,
  type WhisperMock,
} from '../../test/support/whisper-mock.js'
import { normalizeWhisperResponse, TranscriptionError, WhisperClient } from './whisper-client.js'

const isStream = (body: unknown) => body instanceof ReadableStream || body instanceof Readable

describe('WhisperClient', () => {
  let dir: string
  let whisper: WhisperMock

  const audioFile = async (content: Buffer, name = 'call.mp3') => {
    const path = join(dir, name)
    await writeFile(path, content)
    return path
  }

  const transcribe = (path: string, signal = new AbortController().signal) =>
    new WhisperClient().transcribe({ path, filename: 'call.mp3', mimeType: 'audio/mpeg', signal })

  beforeEach(async () => {
    dir = join(tmpdir(), `whisper-client-${randomUUID()}`)
    await mkdir(dir, { recursive: true })
    whisper = await startWhisperMock()
    vi.stubEnv('WHISPER_URL', whisper.url)
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    await whisper.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('отправляет файл потоком в /v1/audio/transcriptions и нормализует ответ', async () => {
    // несколько МиБ случайных байт: сервер должен получить файл без искажений
    const content = randomBytes(3 * 1024 * 1024 + 17)
    const path = await audioFile(content)
    whisper.enqueue(transcriptReply('Обсудили релиз и сроки'))
    const realFetch = globalThis.fetch
    const bodies: unknown[] = []
    vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
      bodies.push(init?.body)
      return realFetch(input, init)
    })

    const transcript = await transcribe(path)

    expect(transcript).toEqual({
      text: 'Обсудили релиз и сроки',
      language: 'ru',
      duration: 12.5,
      segments: [{ start: 0, end: 12.5, text: 'Обсудили релиз и сроки' }],
    })
    // тело — поток, а не прочитанный в память файл (Buffer, строка, Blob из буфера). Контракт
    // клиента: `fetch` с multipart, собранным потоком из `createReadStream` (так же отмена и
    // таймаут обрывают и чтение с диска)
    expect(bodies).toHaveLength(1)
    expect(isStream(bodies[0])).toBe(true)

    expect(whisper.requests).toHaveLength(1)
    const [request] = whisper.requests
    expect(request.path).toBe(TRANSCRIPTIONS_PATH)
    expect(request.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    expect(request.fields.response_format).toBe('verbose_json')
    expect(request.filename).toMatch(/\.mp3$/)
    expect(request.mimeType).toBe('audio/mpeg')
    expect(request.file?.equals(content)).toBe(true)
    // длина известна заранее: тело не chunked, сервер видит размер до приёма файла
    expect(request.headers['transfer-encoding']).toBeUndefined()
    expect(Number(request.headers['content-length'])).toBeGreaterThan(content.length)
  })

  it('Content-Length совпадает с телом и у пустого файла', async () => {
    const path = await audioFile(Buffer.alloc(0))
    whisper.enqueue(transcriptReply(''))

    await transcribe(path)

    const [request] = whisper.requests
    expect(request.file?.length).toBe(0)
    expect(request.headers['content-length']).toBeDefined()
  })

  it('4xx — файл отклонён, повтор не поможет: retryable = false; 5xx, 408, 429 — retryable', async () => {
    const path = await audioFile(Buffer.from('ID3 fake audio'))
    const retryable = async (status: number) => {
      whisper.enqueue(whisperErrorReply(status, 'no audio stream'))
      const error = await transcribe(path).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(TranscriptionError)
      return (error as TranscriptionError).retryable
    }

    expect(await retryable(400)).toBe(false)
    expect(await retryable(415)).toBe(false)
    expect(await retryable(500)).toBe(true)
    expect(await retryable(503)).toBe(true)
    expect(await retryable(408)).toBe(true)
    expect(await retryable(429)).toBe(true)
  })

  it('whisper.cpp: 500 «FFmpeg conversion failed» (видео без звука, битый файл) — retryable = false', async () => {
    const path = await audioFile(Buffer.from('not a media file'))
    whisper.enqueue(whisperErrorReply(500, '{"error":"FFmpeg conversion failed."}'))

    const error = await transcribe(path).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(TranscriptionError)
    expect((error as TranscriptionError).retryable).toBe(false)
    expect((error as Error).message).not.toContain('FFmpeg')
  })

  it('передаёт язык из WHISPER_LANGUAGE, без него — автоопределение', async () => {
    const path = await audioFile(Buffer.from('ID3 fake audio'))

    vi.stubEnv('WHISPER_LANGUAGE', 'ru')
    await transcribe(path)
    vi.stubEnv('WHISPER_LANGUAGE', '')
    await transcribe(path)

    expect(whisper.requests[0].fields.language).toBe('ru')
    expect(whisper.requests[1].fields).not.toHaveProperty('language')
  })

  it('молчащий Whisper — понятная ошибка по таймауту WHISPER_TIMEOUT_MS, а не зависание', async () => {
    vi.stubEnv('WHISPER_TIMEOUT_MS', '200')
    whisper.setFallback(silentReply())
    const path = await audioFile(Buffer.from('ID3 fake audio'))

    const error = await transcribe(path).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(TranscriptionError)
    expect(String((error as Error).message)).toMatch(/транскриб/i)
    expect(String((error as Error).message)).toMatch(/врем|таймаут/i)
    // текст ошибки показывается владельцу встречи: без адреса сервера
    expect(String((error as Error).message)).not.toContain(whisper.url)
  }, 5_000)

  it('недоступный Whisper — понятная ошибка без адреса сервера', async () => {
    const path = await audioFile(Buffer.from('ID3 fake audio'))
    // привилегированный порт 1 на loopback никто не слушает: соединение отклоняется
    const url = 'http://127.0.0.1:1'
    vi.stubEnv('WHISPER_URL', url)

    const error = await transcribe(path).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(TranscriptionError)
    expect(String((error as Error).message)).toMatch(/недоступ/i)
    expect(String((error as Error).message)).not.toContain(url)
  })

  it('HTTP-ошибка Whisper — TranscriptionError без ответа сервера в тексте', async () => {
    whisper.setFallback(whisperErrorReply(500, 'CUDA out of memory at 0xdeadbeef'))
    const path = await audioFile(Buffer.from('ID3 fake audio'))

    const error = await transcribe(path).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(TranscriptionError)
    expect(String((error as Error).message)).not.toContain('0xdeadbeef')
    expect(String((error as Error).message)).not.toContain(whisper.url)
  })

  it('отмена по сигналу обрывает запрос', async () => {
    whisper.setFallback(silentReply())
    const path = await audioFile(Buffer.from('ID3 fake audio'))
    const controller = new AbortController()

    const pending = transcribe(path, controller.signal)
    await vi.waitFor(() => expect(whisper.requests).toHaveLength(1))
    controller.abort(new Error('cancelled'))

    await expect(pending).rejects.toThrow()
  })
})

describe('normalizeWhisperResponse', () => {
  it('whisper.cpp: language — полное имя → код, лишние tokens/words и прочие поля отброшены', () => {
    expect(normalizeWhisperResponse(whisperCppResponse('Привет всем'))).toEqual({
      text: 'Привет всем',
      language: 'ru',
      duration: 12.5,
      segments: [{ start: 0, end: 12.5, text: 'Привет всем' }],
    })
    expect(normalizeWhisperResponse(whisperCppResponse('Hello', 'english')).language).toBe('en')
  })

  it('OpenAI `json` без сегментов и языка', () => {
    expect(normalizeWhisperResponse({ text: ' Hi there ' })).toEqual({
      text: 'Hi there',
      language: null,
      duration: null,
      segments: [],
    })
  })

  it('код языка остаётся кодом, неизвестный язык — null', () => {
    expect(normalizeWhisperResponse({ text: 'x', language: 'ru' }).language).toBe('ru')
    expect(normalizeWhisperResponse({ text: 'x', language: 'Russian' }).language).toBe('ru')
    expect(normalizeWhisperResponse({ text: 'x', language: 'klingon' }).language).toBeNull()
  })

  it('ответ без текста — TranscriptionError, повтор не поможет', () => {
    expect(() => normalizeWhisperResponse({ language: 'ru' })).toThrow(
      expect.objectContaining({ retryable: false }),
    )
  })

  it('ответ без текста — TranscriptionError', () => {
    expect(() => normalizeWhisperResponse({ segments: [] })).toThrow(TranscriptionError)
    expect(() => normalizeWhisperResponse('oops')).toThrow(TranscriptionError)
  })
})
