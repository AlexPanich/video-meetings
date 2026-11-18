// Мок Whisper-сервера (OpenAI-совместимый `POST /v1/audio/transcriptions`, как whisper.cpp
// `whisper-server`) для unit и e2e: настоящий HTTP-сервер на 127.0.0.1. Запросы на loopback мок
// Ollama (`llm-mock.ts`) пропускает в настоящий `fetch`, поэтому оба мока работают вместе, а
// клиент транскрибации проверяется с настоящей потоковой отправкой multipart.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import busboy from 'busboy'

export const TRANSCRIPTIONS_PATH = '/v1/audio/transcriptions'

export interface WhisperRequest {
  method: string
  path: string
  headers: IncomingMessage['headers']
  /** Текстовые поля формы: `model`, `language`, `response_format`… */
  fields: Record<string, string>
  /** Имя файла из части `file`. */
  filename?: string
  mimeType?: string
  /** Файл целиком, как его получил сервер. */
  file?: Buffer
}

export type WhisperHandler = (request: WhisperRequest, res: ServerResponse) => void | Promise<void>

/** Ответ whisper.cpp `verbose_json`: `language` — полное имя, в сегментах лишние `tokens`/`words`. */
export const whisperCppResponse = (text: string, language = 'russian') => ({
  task: 'transcribe',
  language,
  duration: 12.5,
  text: ` ${text}`,
  segments: [
    {
      id: 0,
      text: ` ${text}`,
      start: 0,
      end: 12.5,
      tokens: [50365, 3450, 1234, 50990],
      words: [{ word: text.split(' ')[0], start: 0, end: 1, t_dtw: -1, probability: 0.93 }],
      temperature: 0,
      avg_logprob: -0.21,
      no_speech_prob: 0.01,
    },
  ],
  detected_language: language,
  detected_language_probability: 0.98,
})

const sendJson = (res: ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** Успешная транскрипция с текстом `text` в формате whisper.cpp. */
export const transcriptReply =
  (text: string, language = 'russian'): WhisperHandler =>
  (_request, res) =>
    sendJson(res, whisperCppResponse(text, language))

/** HTTP-ошибка сервера. */
export const whisperErrorReply =
  (status = 500, text = 'whisper crashed'): WhisperHandler =>
  (_request, res) => {
    res.writeHead(status, { 'content-type': 'text/plain' })
    res.end(text)
  }

/** Сервер принял запрос и молчит: клиент должен отвалиться по таймауту. */
export const silentReply = (): WhisperHandler => () => new Promise<void>(() => {})

/** Ответ, который ждёт `release()`: пока он не отпущен, задача висит в `transcribing`. */
export function heldWhisperReply(then: WhisperHandler) {
  let release!: () => void
  let reached!: () => void
  let dropped!: () => void
  const released = new Promise<void>((resolve) => (release = resolve))
  const called = new Promise<void>((resolve) => (reached = resolve))
  /** Клиент оборвал соединение, не дождавшись ответа (отмена задачи). */
  const aborted = new Promise<void>((resolve) => (dropped = resolve))
  const handler: WhisperHandler = async (request, res) => {
    reached()
    // клиент мог отменить запрос, пока ответ удерживается: отвечать уже некому
    const closed = new Promise<boolean>((resolve) =>
      res.on('close', () => {
        if (!res.writableEnded) dropped()
        resolve(true)
      }),
    )
    if (await Promise.race([released.then(() => false), closed])) return
    await then(request, res)
  }
  return { handler, release, called, aborted }
}

const parseMultipart = (req: IncomingMessage, request: WhisperRequest) =>
  new Promise<void>((resolve, reject) => {
    const parser = busboy({ headers: req.headers, defParamCharset: 'utf8' })
    const chunks: Buffer[] = []
    parser.on('field', (name, value) => (request.fields[name] = value))
    parser.on('file', (name, stream, info) => {
      if (name !== 'file') {
        stream.resume()
        return
      }
      request.filename = info.filename
      request.mimeType = info.mimeType
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
    })
    parser.on('close', () => {
      if (request.filename !== undefined) request.file = Buffer.concat(chunks)
      resolve()
    })
    parser.on('error', reject)
    // клиент оборвал загрузку (отмена, таймаут): `pipe` об этом парсеру не сообщает
    req.on('close', () => {
      if (!req.complete) reject(new Error('request aborted'))
    })
    req.pipe(parser)
  })

export interface WhisperMock {
  /** Базовый адрес для `WHISPER_URL`, например `http://127.0.0.1:54321`. */
  readonly url: string
  /** Все полученные запросы по порядку (после разбора тела). */
  readonly requests: WhisperRequest[]
  /** Ответы на следующие запросы по порядку; когда очередь пуста — `fallback`. */
  enqueue(...handlers: WhisperHandler[]): void
  /** Ответ по умолчанию (изначально — `transcriptReply('Тестовый транскрипт встречи')`). */
  setFallback(handler: WhisperHandler): void
  close(): Promise<void>
}

export async function startWhisperMock(): Promise<WhisperMock> {
  const requests: WhisperRequest[] = []
  const queue: WhisperHandler[] = []
  let fallback: WhisperHandler = transcriptReply('Тестовый транскрипт встречи')

  const server: Server = createServer((req, res) => {
    void (async () => {
      const request: WhisperRequest = {
        method: req.method ?? '',
        path: req.url ?? '',
        headers: req.headers,
        fields: {},
      }
      try {
        if (req.method !== 'POST' || req.url !== TRANSCRIPTIONS_PATH) {
          req.resume()
          return sendJson(res, { error: 'not found' }, 404)
        }
        await parseMultipart(req, request)
        requests.push(request)
        await (queue.shift() ?? fallback)(request, res)
      } catch (error) {
        if (!res.headersSent) sendJson(res, { error: String(error) }, 400)
      }
    })()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    enqueue: (...handlers) => queue.push(...handlers),
    setFallback: (handler) => (fallback = handler),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
