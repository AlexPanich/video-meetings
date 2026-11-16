import { inspect } from 'node:util'
import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleDestroy,
} from '@nestjs/common'
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

// текст ошибок SDK и транспорта (адрес Ollama, ответ модели) владельцу не показываем, только в лог
const GENERIC_ERROR = 'Не удалось составить саммари: модель недоступна или вернула ошибку'

const userMessage = (error: unknown) =>
  error instanceof SummaryError && error.message ? error.message : GENERIC_ERROR

const logMessage = (error: unknown) => {
  if (!(error instanceof Error)) return String(error)
  return error.cause === undefined ? error.message : `${error.message} (${inspect(error.cause)})`
}

/** Фоновая задача саммари в процессе api: `pending` → `generating` → `done` | `failed`. */
@Injectable()
export class SummaryRunner implements OnModuleDestroy, OnApplicationShutdown {
  private readonly logger = new Logger(SummaryRunner.name)
  private readonly running = new Map<AbortController, Promise<void>>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly agent: SummaryAgent,
  ) {}

  /** Выполняет задачу до конца; не бросает исключений — итог записывается в БД. */
  run(meetingId: string): Promise<void> {
    const controller = new AbortController()
    const task = this.execute(meetingId, controller).finally(() => this.running.delete(controller))
    this.running.set(controller, task)
    return task
  }

  // при остановке идущие задачи отменяются и успевают записать `failed`; что не успело (или
  // процесс упал), закроет StaleSummariesCleaner при следующем старте
  async onModuleDestroy(): Promise<void> {
    await this.cancelAll()
  }

  async onApplicationShutdown(): Promise<void> {
    await this.cancelAll()
  }

  private async cancelAll(): Promise<void> {
    for (const controller of this.running.keys()) {
      controller.abort(new SummaryError('Генерация саммари прервана остановкой api'))
    }
    await Promise.allSettled(this.running.values())
  }

  private async execute(meetingId: string, controller: AbortController): Promise<void> {
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
      await this.finish(meetingId, { status: 'done', result: json, error: null })
    } catch (error) {
      const reason: unknown = controller.signal.aborted ? controller.signal.reason : error
      this.logger.warn(`Саммари встречи ${meetingId} не удалось: ${logMessage(reason)}`)
      // прежний результат не трогаем: пересоздание заменяет его только после успеха
      await this.finish(meetingId, { status: 'failed', error: userMessage(reason) })
    }
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
    data: { status: 'done' | 'failed'; result?: Prisma.InputJsonObject; error: string | null },
  ) {
    try {
      // только своя задача: после рестарта её мог закрыть StaleSummariesCleaner
      await this.prisma.meetingSummary.updateMany({
        where: { meetingId, status: 'generating' },
        data,
      })
    } catch (error) {
      this.logger.error(`Не удалось сохранить итог саммари встречи ${meetingId}: ${String(error)}`)
    }
  }
}
