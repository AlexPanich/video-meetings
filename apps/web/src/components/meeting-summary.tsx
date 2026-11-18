'use client'

import { Alert, Button, Card, Chip, Skeleton } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  ApiError,
  getMeetingSummary,
  startMeetingSummary,
  type MeetingSummary as Summary,
  type SummaryResult,
  type SummaryStatus,
} from '@/lib/api'

const STATUS: Record<
  SummaryStatus,
  { label: string; color: 'default' | 'accent' | 'success' | 'danger'; active: boolean }
> = {
  pending: { label: 'В очереди', color: 'default', active: true },
  transcribing: { label: 'Транскрибация', color: 'accent', active: true },
  generating: { label: 'Генерация', color: 'accent', active: true },
  done: { label: 'Готово', color: 'success', active: false },
  failed: { label: 'Ошибка', color: 'danger', active: false },
}

// столько сбоев опроса подряд (API или BFF недоступны) — и опрос останавливается
const MAX_POLL_FAILURES = 5
// после сбоя пауза удваивается, но не дольше этого
const MAX_POLL_DELAY = 30_000

// статус, которого UI ещё не знает (API новее клиента), считаем идущей задачей: опрос продолжается
const UNKNOWN_STATUS = { label: 'Обрабатывается', color: 'default', active: true } as const

const statusInfo = (status: string) =>
  (STATUS as Record<string, (typeof STATUS)[SummaryStatus] | undefined>)[status] ?? UNKNOWN_STATUS

const isActive = (summary: Summary | null) =>
  summary !== null && statusInfo(summary.status).active

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; summary: Summary | null }

// Опрос: каждый запуск эффекта — новая серия запросов; `delay` — пауза перед первым запросом
type Poll = { id: number; delay: number }

export function MeetingSummary({
  meetingId,
  pollInterval = 3000,
}: {
  meetingId: string
  pollInterval?: number
}) {
  const router = useRouter()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [poll, setPoll] = useState<Poll>({ id: 0, delay: 0 })
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  // защита от двойного клика: состояние React обновится только после рендера
  const startingRef = useRef(false)
  // ошибку первой загрузки показываем, а сбой опроса при уже показанных данных — переждём
  const hasData = useRef(false)

  // опрос остановлен после MAX_POLL_FAILURES сбоев подряд: показываем предупреждение и «Повторить»
  const [pollStalled, setPollStalled] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0

    // после сбоев — экспоненциальная пауза, чтобы не долбить лежащий API
    const schedule = () => {
      const delay = Math.min(pollInterval * 2 ** failures, MAX_POLL_DELAY)
      timer = setTimeout(load, delay)
    }

    // в скрытой вкладке не опрашиваем: продолжим, когда её снова откроют
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      document.removeEventListener('visibilitychange', onVisible)
      load()
    }

    async function load() {
      if (cancelled) return
      if (document.visibilityState === 'hidden') {
        document.addEventListener('visibilitychange', onVisible)
        return
      }
      try {
        const summary = await getMeetingSummary(meetingId)
        if (cancelled) return
        failures = 0
        hasData.current = true
        setState({ kind: 'ready', summary })
        // свежий статус: прежняя ошибка запуска уже неактуальна
        if (summary) setStartError(null)
        if (isActive(summary)) schedule()
      } catch (error) {
        if (cancelled) return
        // токен отклонён (прокси уже сбросил cookie): повтор не поможет, нужен вход
        if (error instanceof ApiError && error.status === 401) {
          router.replace('/login')
          return
        }
        if (!hasData.current) setState({ kind: 'error' })
        else if (failures + 1 >= MAX_POLL_FAILURES) setPollStalled(true)
        else {
          schedule()
          failures++
        }
      }
    }

    timer = setTimeout(load, poll.delay)
    return () => {
      cancelled = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [meetingId, pollInterval, poll, router])

  const restartPoll = (delay: number) => {
    setPollStalled(false)
    setPoll((current) => ({ id: current.id + 1, delay }))
  }

  const retryLoad = () => {
    hasData.current = false
    setState({ kind: 'loading' })
    restartPoll(0)
  }

  const start = async () => {
    if (startingRef.current) return
    startingRef.current = true
    setStarting(true)
    setStartError(null)
    try {
      // API отдаёт и прежний `result`: он виден, пока идёт новая задача
      const summary = await startMeetingSummary(meetingId)
      hasData.current = true
      setState({ kind: 'ready', summary })
      restartPoll(pollInterval)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace('/login')
      } else if (error instanceof ApiError && error.status === 409) {
        // задача уже идёт (другая вкладка): вторую не создаём, показываем статус идущей
        restartPoll(0)
      } else {
        setStartError(error instanceof ApiError ? error.message : 'Что-то пошло не так')
      }
    } finally {
      startingRef.current = false
      setStarting(false)
    }
  }

  const summary = state.kind === 'ready' ? state.summary : null
  const active = isActive(summary)
  const result = summary?.result ?? null
  const status = summary ? statusInfo(summary.status) : undefined
  // идёт пересоздание или оно упало — под статусом прежний результат
  const previous = result !== null && (active || summary?.status === 'failed')

  return (
    <Card>
      <Card.Header className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Card.Title>Саммари</Card.Title>
          {/* live-регион: скринридер сообщит о смене статуса при опросе */}
          <span role="status" aria-live="polite">
            {status && (
              <Chip color={status.color} size="sm">
                {status.label}
              </Chip>
            )}
          </span>
        </div>
        {/* при `failed` запуск заново — кнопка «Повторить» рядом с причиной */}
        {state.kind === 'ready' && summary?.status !== 'failed' && (
          <Button size="sm" isPending={starting} isDisabled={active || starting} onPress={start}>
            {result ? 'Пересоздать саммари' : 'Сделать саммари'}
          </Button>
        )}
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        {state.kind === 'loading' && (
          <div role="status" aria-label="Загрузка саммари" className="flex flex-col gap-3">
            <Skeleton className="h-6 w-1/3 rounded-lg" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        )}

        {state.kind === 'error' && (
          <Alert status="danger" role="alert">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Не удалось загрузить саммари</Alert.Title>
              <Button className="mt-2" size="sm" onPress={retryLoad}>
                Повторить
              </Button>
            </Alert.Content>
          </Alert>
        )}

        {pollStalled && (
          <Alert status="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Не удалось обновить статус саммари</Alert.Title>
              <Button className="mt-2" size="sm" onPress={() => restartPoll(0)}>
                Обновить
              </Button>
            </Alert.Content>
          </Alert>
        )}

        {startError && (
          <Alert status="danger" role="alert">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Не удалось запустить саммари</Alert.Title>
              <Alert.Description>{startError}</Alert.Description>
            </Alert.Content>
          </Alert>
        )}

        {summary?.status === 'failed' && (
          <Alert status="danger" role="alert">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Не удалось сделать саммари</Alert.Title>
              {summary.error && <Alert.Description>{summary.error}</Alert.Description>}
              <Button
                className="mt-2"
                size="sm"
                isPending={starting}
                isDisabled={starting}
                onPress={start}
              >
                Повторить
              </Button>
            </Alert.Content>
          </Alert>
        )}

        {state.kind === 'ready' && !summary && (
          <p className="text-muted">
            Саммари ещё нет. Оно строится по текстовым файлам встречи (.txt, .md, .vtt, .srt).
          </p>
        )}

        {previous && <p className="text-sm text-muted">Показано предыдущее саммари</p>}
        {result && <SummarySections result={result} />}
      </Card.Content>
    </Card>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="font-semibold">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Empty() {
  return <p className="text-muted">Нет</p>
}

function TextList({ items }: { items: string[] }) {
  if (items.length === 0) return <Empty />
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  )
}

function SummarySections({ result }: { result: SummaryResult }) {
  return (
    <div className="flex flex-col gap-5">
      <Section title="Резюме">
        <p className="whitespace-pre-line">{result.summary}</p>
      </Section>

      <Section title="Решения">
        <TextList items={result.decisions} />
      </Section>

      <Section title="Задачи">
        {result.actionItems.length === 0 ? (
          <Empty />
        ) : (
          <ul className="flex flex-col gap-2">
            {result.actionItems.map((item, index) => (
              <li key={index} className="rounded-xl bg-default/40 px-3 py-2">
                <p>{item.task}</p>
                {(item.assignee || item.dueDate) && (
                  <p className="text-sm text-muted">
                    {item.assignee && <span>Ответственный: {item.assignee}</span>}
                    {item.assignee && item.dueDate && ' · '}
                    {item.dueDate && <span>Срок: {item.dueDate}</span>}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Открытые вопросы">
        <TextList items={result.openQuestions} />
      </Section>

      {result.skippedFiles.length > 0 && (
        <Section title="Неучтённые файлы">
          <p className="text-sm text-muted">Эти файлы не текстовые, саммари их не учитывает.</p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {result.skippedFiles.map((file) => (
              <li key={file.id} className="break-all">
                {file.name}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
