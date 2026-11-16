import { z } from 'zod'
import type { MeetingSummary, SummaryStatus } from '../generated/prisma/client.js'

// активна ли задача в этом статусе: второй запуск в это время — 409, при старте api такие задачи
// закрываются как прерванные. Новый статус (`transcribing` в фазе 7) без решения не скомпилируется
const SUMMARY_STATUS_ACTIVE = {
  pending: true,
  generating: true,
  done: false,
  failed: false,
} as const satisfies Record<SummaryStatus, boolean>

export const SUMMARY_STATUSES = Object.keys(SUMMARY_STATUS_ACTIVE) as SummaryStatus[]

export const ACTIVE_SUMMARY_STATUSES = SUMMARY_STATUSES.filter(
  (status) => SUMMARY_STATUS_ACTIVE[status],
)

// поля ответа модели: из схемы строится JSON Schema для `outputFormat`, ею же проверяется ответ;
// описания полей повторяются в системном промпте (Qwen заполняет поля точнее)
export const summaryOutputSchema = z.strictObject({
  summary: z.string().describe('Краткое резюме встречи: 3–6 предложений'),
  decisions: z.array(z.string()).describe('Решения, которые участники приняли на встрече'),
  actionItems: z
    .array(
      z.strictObject({
        task: z.string().describe('Что сделать'),
        assignee: z.string().optional().describe('Кто отвечает, если назван'),
        dueDate: z
          .string()
          .optional()
          .describe('Срок, если назван (YYYY-MM-DD, если известна дата)'),
      }),
    )
    .describe('Задачи, которые кто-то должен выполнить после встречи'),
  openQuestions: z.array(z.string()).describe('Вопросы, которые остались без ответа'),
})

export type SummaryOutput = z.infer<typeof summaryOutputSchema>

// без `$schema`: схема уходит в Ollama как `format` и в системный промпт
export const SUMMARY_JSON_SCHEMA: Record<string, unknown> = {
  ...z.toJSONSchema(summaryOutputSchema),
}
delete SUMMARY_JSON_SCHEMA.$schema

/** Ошибка саммари, текст которой можно показать владельцу встречи (`MeetingSummary.error`). */
export class SummaryError extends Error {}

export interface SkippedFile {
  id: string
  name: string
}

// результат, который хранится в `MeetingSummary.result`: ответ модели и файлы, которые не учтены
export interface SummaryResult extends SummaryOutput {
  skippedFiles: SkippedFile[]
}

export interface PublicSummary {
  meetingId: string
  status: MeetingSummary['status']
  result: SummaryResult | null
  error: string | null
  createdAt: Date
  updatedAt: Date
}

export const toPublicSummary = ({
  meetingId,
  status,
  result,
  error,
  createdAt,
  updatedAt,
}: MeetingSummary): PublicSummary => ({
  meetingId,
  status,
  // пишет `result` только SummaryRunner, всегда в форме SummaryResult
  result: (result as SummaryResult | null) ?? null,
  error,
  createdAt,
  updatedAt,
})
