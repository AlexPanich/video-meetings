// Схемы ответа для Swagger: PublicSummary — TS-тип, плагин Nest CLI строит схемы только из классов
import { ApiProperty } from '@nestjs/swagger'
import type { SummaryStatus } from '../generated/prisma/client.js'
import { SUMMARY_STATUSES } from './summary.js'

export class ActionItemDto {
  /** Что сделать */
  task: string
  /** Кто отвечает, если назван */
  assignee?: string
  /** Срок, если назван */
  dueDate?: string
}

export class SkippedFileDto {
  id: string
  name: string
}

export class SummaryResultDto {
  /** Краткое резюме встречи */
  summary: string
  /** Принятые решения */
  decisions: string[]
  /** Задачи после встречи */
  actionItems: ActionItemDto[]
  /** Открытые вопросы */
  openQuestions: string[]
  /** Файлы встречи, которые не учтены (не `.txt`, `.md`, `.vtt`, `.srt`) */
  skippedFiles: SkippedFileDto[]
}

export class SummaryDto {
  meetingId: string
  @ApiProperty({
    enum: SUMMARY_STATUSES,
    description: '`pending` → `generating` → `done` | `failed`',
  })
  status: SummaryStatus
  /** Последнее успешное саммари; при пересоздании остаётся прежним до успеха */
  result: SummaryResultDto | null
  /** Причина последней неудачи, при `failed` */
  error: string | null
  createdAt: Date
  updatedAt: Date
}
