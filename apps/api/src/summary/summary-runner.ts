import { inspect } from 'node:util'
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import type { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { SummaryAgent } from './summary-agent.js'
import { SummaryError } from './summary.js'

// ограничение на задачу целиком (`SUMMARY_TIMEOUT_MS`): `OLLAMA_TIMEOUT_MS` ограничивает только
// один запрос, а агентный цикл по длинной встрече состоит из десятков запросов
export const DEFAULT_SUMMARY_TIMEOUT_MS = 15 * 60 * 1000
// больше `setTimeout` не умеет: таймер сработал бы сразу
const MAX_TIMER_MS = 2_147_483_647

// env читается при каждом запуске, чтобы значение можно было менять в тестах
export const getSummaryTimeoutMs = () => {
  const value = Number(process.env.SUMMARY_TIMEOUT_MS)
  return Number.isInteger(value) && value > 0
    ? Math.min(value, MAX_TIMER_MS)
    : DEFAULT_SUMMARY_TIMEOUT_MS
}

// одновременных генераций (`SUMMARY_CONCURRENCY`): Ollama одна и на одном GPU, лишние задачи
// ждут своей очереди в `pending`, а не делят GPU и не упираются все вместе в таймаут
export const DEFAULT_SUMMARY_CONCURRENCY = 1

export const getSummaryConcurrency = () => {
  const value = Number(process.env.SUMMARY_CONCURRENCY)
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_SUMMARY_CONCURRENCY
}

// текст ошибок SDK и транспорта (адрес Ollama, ответ модели) владельцу не показываем, только в лог
const GENERIC_ERROR = 'Не удалось составить саммари: модель недоступна или вернула ошибку'

const userMessage = (error: unknown) =>
  error instanceof SummaryError && error.message ? error.message : GENERIC_ERROR

const logMessage = (error: unknown) => {
  if (!(error instanceof Error)) return String(error)
  return error.cause === undefined ? error.message : `${error.message} (${inspect(error.cause)})`
}

interface RunningTask {
  meetingId: string
  task: Promise<void>
}

/**
 * Фоновая задача саммари в процессе api: `pending` (в очереди) → `generating` → `done` | `failed`.
 * Одновременно генерируется не больше `SUMMARY_CONCURRENCY` задач, остальные ждут в `pending`.
 */
@Injectable()
export class SummaryRunner implements OnModuleDestroy {
  private readonly logger = new Logger(SummaryRunner.name)
  private readonly running = new Map<AbortController, RunningTask>()
  private generating = 0
  private readonly queue: (() => void)[] = []

  constructor(
    private readonly prisma: PrismaService,
    private readonly agent: SummaryAgent,
  ) {}

  /** Выполняет задачу до конца; не бросает исключений — итог записывается в БД. */
  run(meetingId: string): Promise<void> {
    const controller = new AbortController()
    const task = this.execute(meetingId, controller).finally(() => this.running.delete(controller))
    this.running.set(controller, { meetingId, task })
    return task
  }

  /** Отменяет задачу встречи (встречу удалили): GPU не тратится на то, что уже некому показать. */
  async cancel(meetingId: string): Promise<void> {
    const tasks: Promise<void>[] = []
    for (const [controller, running] of this.running) {
      if (running.meetingId !== meetingId) continue
      controller.abort(new SummaryError('Генерация саммари отменена: встреча удалена'))
      tasks.push(running.task)
    }
    await Promise.allSettled(tasks)
  }

  // при остановке идущие задачи отменяются и успевают записать `failed`; что не успело (или
  // процесс упал), закроет StaleSummariesCleaner при следующем старте. Хук `onModuleDestroy`, а не
  // `onApplicationShutdown`: тот вызывается после закрытия PrismaService, и записать итог уже нельзя
  async onModuleDestroy(): Promise<void> {
    for (const controller of this.running.keys()) {
      controller.abort(new SummaryError('Генерация саммари прервана остановкой api'))
    }
    await Promise.allSettled([...this.running.values()].map(({ task }) => task))
  }

  private async execute(meetingId: string, controller: AbortController): Promise<void> {
    try {
      await this.acquire(controller.signal)
    } catch {
      // отменена в очереди: задача ещё в `pending`
      await this.fail(meetingId, 'pending', controller.signal.reason)
      return
    }
    try {
      await this.generate(meetingId, controller)
    } finally {
      this.release()
    }
  }

  // место среди `SUMMARY_CONCURRENCY` генераций; отмена снимает задачу с очереди
  private acquire(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.generating < getSummaryConcurrency()) {
      this.generating++
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      const start = () => {
        signal.removeEventListener('abort', onAbort)
        this.generating++
        resolve()
      }
      const onAbort = () => {
        this.queue.splice(this.queue.indexOf(start), 1)
        reject(signal.reason as Error)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.queue.push(start)
    })
  }

  private release(): void {
    this.generating--
    if (this.generating < getSummaryConcurrency()) this.queue.shift()?.()
  }

  private async generate(meetingId: string, controller: AbortController): Promise<void> {
    try {
      // задачу могли удалить вместе со встречей или закрыть при старте другого процесса api
      const { count } = await this.prisma.meetingSummary.updateMany({
        where: { meetingId, status: 'pending' },
        data: { status: 'generating' },
      })
      if (count === 0) return
    } catch (error) {
      this.logger.error(`Не удалось начать саммари встречи ${meetingId}: ${String(error)}`)
      return
    }

    try {
      const result = await this.withTimeout(meetingId, controller)
      // JSON-совместим по построению (разобран zod-схемой), но интерфейс без индексной сигнатуры
      const json = result as unknown as Prisma.InputJsonObject
      await this.finish(meetingId, 'generating', { status: 'done', result: json, error: null })
    } catch (error) {
      await this.fail(
        meetingId,
        'generating',
        controller.signal.aborted ? controller.signal.reason : error,
      )
    }
  }

  private async fail(meetingId: string, from: 'pending' | 'generating', reason: unknown) {
    this.logger.warn(`Саммари встречи ${meetingId} не удалось: ${logMessage(reason)}`)
    // прежний результат не трогаем: пересоздание заменяет его только после успеха
    await this.finish(meetingId, from, { status: 'failed', error: userMessage(reason) })
  }

  // агент получает сигнал отмены, но задача не ждёт агента, который на него не реагирует
  private async withTimeout(meetingId: string, controller: AbortController) {
    const timeoutMs = getSummaryTimeoutMs()
    const timer = setTimeout(
      () =>
        controller.abort(new SummaryError(`Превышено время генерации саммари (${timeoutMs} мс)`)),
      timeoutMs,
    )
    let onAbort = () => {}
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(controller.signal.reason as Error)
      controller.signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      return await Promise.race([this.agent.run(meetingId, controller.signal), aborted])
    } finally {
      clearTimeout(timer)
      controller.signal.removeEventListener('abort', onAbort)
    }
  }

  private async finish(
    meetingId: string,
    from: 'pending' | 'generating',
    data: { status: 'done' | 'failed'; result?: Prisma.InputJsonObject; error: string | null },
  ) {
    try {
      // только своя задача: после рестарта её мог закрыть StaleSummariesCleaner, а встречу — удалить
      await this.prisma.meetingSummary.updateMany({
        where: { meetingId, status: from },
        data,
      })
    } catch (error) {
      this.logger.error(`Не удалось сохранить итог саммари встречи ${meetingId}: ${String(error)}`)
    }
  }
}
