// Схемы ответа для Swagger: PublicSummary — TS-тип, плагин Nest CLI строит схемы только из классов

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
  /** `pending` → `generating` → `done` | `failed` */
  status: 'pending' | 'generating' | 'done' | 'failed'
  /** Последнее успешное саммари; при пересоздании остаётся прежним до успеха */
  result: SummaryResultDto | null
  /** Причина последней неудачи, при `failed` */
  error: string | null
  createdAt: Date
  updatedAt: Date
}
