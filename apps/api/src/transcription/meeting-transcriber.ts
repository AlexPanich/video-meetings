import { extname } from 'node:path'
import { inspect } from 'node:util'
import { Injectable, Logger } from '@nestjs/common'
import type { MeetingFile } from '../generated/prisma/client.js'
import { getStoragePath } from '../files/storage.js'
import { prismaErrorCode } from '../files/stored-file.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { TranscriptionError, WhisperClient } from './whisper-client.js'

// аудио и видео, которые транскрибируются перед саммари: по MIME из загрузки или по расширению
// (браузер часто присылает `application/octet-stream`)
export const MEDIA_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.ogg',
  '.oga',
  '.opus',
  '.flac',
  '.wma',
  '.amr',
  '.webm',
  '.mp4',
  '.m4v',
  '.mov',
  '.mkv',
  '.avi',
  '.wmv',
  '.3gp',
])

export const isMediaFile = ({ name, mimeType }: Pick<MeetingFile, 'name' | 'mimeType'>) =>
  /^(audio|video)\//i.test(mimeType) || MEDIA_EXTENSIONS.has(extname(name).toLowerCase())

/** Транскрипт файла встречи, который агент саммари читает как текстовый источник. */
export interface MeetingTranscriptSource {
  fileId: string
  name: string
  text: string
}

const lowerFirst = (value: string) => value.charAt(0).toLowerCase() + value.slice(1)

/**
 * Этап `transcribing` задачи саммари: аудио и видео встречи без готового транскрипта уходят в
 * Whisper по одному, транскрипт сохраняется в `MeetingTranscript` и при следующем запуске
 * берётся оттуда. Как и агент, читает `MeetingFile` и файлы на диске напрямую: доступ к встрече
 * уже проверен командой запуска.
 */
@Injectable()
export class MeetingTranscriber {
  private readonly logger = new Logger(MeetingTranscriber.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly whisper: WhisperClient,
  ) {}

  /**
   * Транскрипты всех загруженных аудио и видео встречи. `onTranscribing` вызывается один раз
   * перед первым запросом к Whisper — если транскрибировать нечего, не вызывается.
   */
  async prepare(
    meetingId: string,
    signal: AbortSignal,
    onTranscribing: () => Promise<void>,
  ): Promise<MeetingTranscriptSource[]> {
    signal.throwIfAborted()
    const files = await this.prisma.meetingFile.findMany({
      where: { meetingId, status: 'uploaded' },
      orderBy: { createdAt: 'asc' },
      include: { transcript: { select: { storageName: true, fileSize: true, text: true } } },
    })
    const media = files.filter(isMediaFile)
    const texts = new Map<string, string>()
    const pending: typeof media = []
    for (const file of media) {
      const { transcript } = file
      // признак изменения файла: транскрипт другого содержимого не годится
      const fresh =
        transcript !== null &&
        transcript.storageName === file.storageName &&
        transcript.fileSize === file.size
      if (fresh) texts.set(file.id, transcript.text)
      else pending.push(file)
    }
    if (pending.length > 0) await onTranscribing()

    for (const file of pending) {
      signal.throwIfAborted()
      const transcript = await this.whisper
        .transcribe({
          path: getStoragePath(meetingId, file.storageName),
          filename: file.name,
          mimeType: file.mimeType,
          signal,
        })
        .catch((error: unknown) => {
          if (signal.aborted || !(error instanceof TranscriptionError)) throw error
          this.logger.warn(
            `Транскрибация файла ${file.id} встречи ${meetingId} не удалась: ${error.message}` +
              (error.cause === undefined ? '' : ` (${inspect(error.cause)})`),
          )
          // сервис отклонил сам файл (видео без звука, неподдерживаемый формат): повтор упал бы
          // так же, поэтому файл без транскрипта уходит в `skippedFiles`, а саммари строится по
          // остальным
          if (!error.retryable) return null
          throw new TranscriptionError(
            `Не удалось транскрибировать ${file.name}: ${lowerFirst(error.message)}`,
            { cause: error },
          )
        })
      if (transcript === null) continue
      // встречу удалили, пока Whisper работал: транскрипт уже некому показать
      signal.throwIfAborted()
      const data = {
        storageName: file.storageName,
        fileSize: file.size,
        text: transcript.text,
        language: transcript.language,
        duration: transcript.duration,
        segments: transcript.segments.map((segment) => ({ ...segment })),
      }
      try {
        await this.prisma.meetingTranscript.upsert({
          where: { fileId: file.id },
          create: { fileId: file.id, ...data },
          update: data,
        })
      } catch (error) {
        // файл удалили, пока Whisper работал: он больше не источник, остальные — да
        if (prismaErrorCode(error) === 'P2003') continue
        throw error
      }
      texts.set(file.id, transcript.text)
    }

    return media.flatMap((file) => {
      const text = texts.get(file.id)
      return text === undefined ? [] : [{ fileId: file.id, name: file.name, text }]
    })
  }
}
