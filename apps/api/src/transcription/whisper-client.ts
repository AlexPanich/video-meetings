import { randomBytes } from 'node:crypto'
import { open } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { Injectable } from '@nestjs/common'
import { WHISPER_LANGUAGES } from './whisper-languages.js'

// Провайдер транскрибации не зависит от `LLM_PROVIDER`: и с Qwen, и с Claude аудио и видео
// транскрибирует OpenAI-совместимый `POST /v1/audio/transcriptions` (whisper.cpp `whisper-server`
// на второй машине). Видео отправляется как есть: аудиодорожку извлекает сервер (whisper.cpp
// с флагом `--convert`, через ffmpeg), API ffmpeg не нужен

export const DEFAULT_WHISPER_URL = 'http://localhost:8080'
// один файл до 500 МиБ на GPU транскрибируется минуты; задачу целиком ограничивает ещё и
// `SUMMARY_TIMEOUT_MS`
export const DEFAULT_WHISPER_TIMEOUT_MS = 10 * 60 * 1000
const MAX_TIMER_MS = 2_147_483_647
const TRANSCRIPTIONS_PATH = '/v1/audio/transcriptions'
// OpenAI требует поле `model`, whisper.cpp его игнорирует (модель задаётся при запуске сервера)
const WHISPER_MODEL = 'whisper-1'

// env читается при каждом вызове, чтобы значение можно было менять в тестах
export const getWhisperUrl = () => process.env.WHISPER_URL || DEFAULT_WHISPER_URL

export const getWhisperLanguage = () => process.env.WHISPER_LANGUAGE?.trim() || undefined

export const getWhisperTimeoutMs = () => {
  const value = Number(process.env.WHISPER_TIMEOUT_MS)
  return Number.isInteger(value) && value > 0
    ? Math.min(value, MAX_TIMER_MS)
    : DEFAULT_WHISPER_TIMEOUT_MS
}

/**
 * Ошибка транскрибации, текст которой можно показать владельцу встречи: без адреса сервиса и его
 * ответа (они — в `cause`, для лога).
 */
export class TranscriptionError extends Error {}

export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

export interface WhisperTranscript {
  text: string
  /** Код ISO 639-1 (`ru`), `null` — сервис язык не вернул или он неизвестен. */
  language: string | null
  /** Длительность в секундах. */
  duration: number | null
  segments: TranscriptSegment[]
}

export interface TranscribeInput {
  /** Путь к файлу на диске: он отправляется потоком, без чтения в память. */
  path: string
  filename: string
  mimeType: string
  signal: AbortSignal
}

const CODES = new Set(Object.values(WHISPER_LANGUAGES))

// whisper.cpp отдаёт полное имя (`russian`), OpenAI — код (`ru`)
const normalizeLanguage = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const language = value.trim().toLowerCase()
  if (CODES.has(language)) return language
  return WHISPER_LANGUAGES[language] ?? null
}

const finiteNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Ответ `json`/`verbose_json` (OpenAI или whisper.cpp) → общий вид: текст, код языка,
 * длительность и сегменты без `tokens`, `words` и прочих полей.
 */
export function normalizeWhisperResponse(body: unknown): WhisperTranscript {
  if (!isRecord(body) || typeof body.text !== 'string') {
    throw new TranscriptionError('Сервис транскрибации вернул некорректный ответ')
  }
  const segments = Array.isArray(body.segments) ? body.segments : []
  return {
    text: body.text.trim(),
    language: normalizeLanguage(body.language),
    duration: finiteNumber(body.duration),
    segments: segments.flatMap((segment) => {
      if (!isRecord(segment) || typeof segment.text !== 'string') return []
      const start = finiteNumber(segment.start)
      const end = finiteNumber(segment.end)
      if (start === null || end === null) return []
      return [{ start, end, text: segment.text.trim() }]
    }),
  }
}

// значение параметра в заголовке части: кавычки и переводы строк сломали бы разметку multipart
const quoted = (value: string) => `"${value.replace(/["\\\r\n]/g, '_')}"`

// multipart/form-data потоком: текстовые поля, затем файл с диска, затем закрывающая граница
function multipartBody(
  boundary: string,
  fields: Record<string, string>,
  file: { filename: string; mimeType: string; stream: Readable },
): Readable {
  async function* parts() {
    for (const [name, value] of Object.entries(fields)) {
      yield Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name=${quoted(name)}\r\n\r\n${value}\r\n`,
      )
    }
    yield Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename=${quoted(file.filename)}\r\n` +
        `Content-Type: ${file.mimeType}\r\n\r\n`,
    )
    yield* file.stream
    yield Buffer.from(`\r\n--${boundary}--\r\n`)
  }
  return Readable.from(parts(), { objectMode: false })
}

@Injectable()
export class WhisperClient {
  /** Транскрипт файла. Ошибки сервиса — `TranscriptionError`, отмена — причина `signal`. */
  async transcribe({
    path,
    filename,
    mimeType,
    signal,
  }: TranscribeInput): Promise<WhisperTranscript> {
    signal.throwIfAborted()
    const timeoutMs = getWhisperTimeoutMs()
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort(new Error('timeout'))
    }, timeoutMs)
    const onAbort = () => controller.abort(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })

    const failure = (error: unknown) => {
      if (signal.aborted) return signal.reason as Error
      if (timedOut) {
        return new TranscriptionError(`Превышено время транскрибации (${timeoutMs} мс)`, {
          cause: error,
        })
      }
      if (error instanceof TranscriptionError) return error
      return new TranscriptionError('Сервис транскрибации недоступен', { cause: error })
    }

    let handle
    try {
      handle = await open(path, 'r')
    } catch (error) {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      throw new TranscriptionError('Не удалось прочитать файл для транскрибации', { cause: error })
    }
    const stream = handle.createReadStream()

    try {
      const language = getWhisperLanguage()
      const boundary = `----video-meetings-${randomBytes(16).toString('hex')}`
      const body = multipartBody(
        boundary,
        {
          model: WHISPER_MODEL,
          response_format: 'verbose_json',
          ...(language ? { language } : {}),
        },
        { filename, mimeType, stream },
      )
      const response = await fetch(new URL(TRANSCRIPTIONS_PATH, getWhisperUrl()), {
        method: 'POST',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        body: body as unknown as BodyInit,
        // поток в теле запроса fetch Node принимает только в полудуплексе
        duplex: 'half',
        signal: controller.signal,
      } as RequestInit)
      if (!response.ok) {
        // ответ сервиса (трассировки, адреса) — только в `cause`
        const text = await response.text().catch(() => '')
        throw new TranscriptionError(
          `Сервис транскрибации вернул ошибку (HTTP ${response.status})`,
          { cause: text.slice(0, 1000) },
        )
      }
      let json: unknown
      try {
        json = await response.json()
      } catch (error) {
        if (controller.signal.aborted) throw error
        throw new TranscriptionError('Сервис транскрибации вернул некорректный ответ', {
          cause: error,
        })
      }
      return normalizeWhisperResponse(json)
    } catch (error) {
      throw failure(error)
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      stream.destroy()
      await handle.close().catch(() => {})
    }
  }
}
