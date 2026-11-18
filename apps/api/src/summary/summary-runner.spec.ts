import { SAMPLE_SUMMARY } from '../../test/support/llm-mock.js'
import { TranscriptionError } from '../transcription/whisper-client.js'
import { SummaryRunner } from './summary-runner.js'

const RESULT = { ...SAMPLE_SUMMARY, skippedFiles: [{ id: 'f-pdf', name: 'slides.pdf' }] }

const prismaMock = () => ({
  meetingSummary: {
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
})

type PrismaMock = ReturnType<typeof prismaMock>

// данные всех записей в `MeetingSummary` по порядку, независимо от того, через update или updateMany
const writes = (prisma: PrismaMock) =>
  [prisma.meetingSummary.update.mock, prisma.meetingSummary.updateMany.mock]
    .flatMap(({ calls, invocationCallOrder }) =>
      calls.map(([args], index) => ({
        order: invocationCallOrder[index],
        data: (args as { data: Record<string, unknown> }).data,
      })),
    )
    .sort((a, b) => a.order - b.order)
    .map(({ data }) => data)

const lastWrite = (prisma: PrismaMock) => writes(prisma).at(-1)

// транскрибатор встречи без аудио и видео: транскрибировать нечего, транскриптов нет
const noTranscripts = () => ({ prepare: vi.fn().mockResolvedValue([]) })

// агент, который ждёт отмены и тогда отвергает промис
const abortableAgent = () => ({
  run: vi.fn(
    (_meetingId: string, signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }),
  ),
})

describe('SummaryRunner', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('переводит задачу в generating, затем в done с результатом', async () => {
    const prisma = prismaMock()
    const agent = { run: vi.fn().mockResolvedValue(RESULT) }

    await new SummaryRunner(prisma as never, agent as never, noTranscripts() as never).run(
      'meeting-1',
    )

    expect(agent.run).toHaveBeenCalledWith('meeting-1', expect.any(AbortSignal), [])
    const statuses = writes(prisma).map((data) => data.status)
    expect(statuses).toEqual(['generating', 'done'])
    expect(lastWrite(prisma)).toMatchObject({ status: 'done', result: RESULT, error: null })
  })

  it('ошибка агента → failed с причиной, прежний результат не затирается', async () => {
    const prisma = prismaMock()
    const agent = { run: vi.fn().mockRejectedValue(new Error('Ollama is unreachable')) }

    await new SummaryRunner(prisma as never, agent as never, noTranscripts() as never).run(
      'meeting-1',
    )

    const failed = lastWrite(prisma)
    expect(failed).toMatchObject({ status: 'failed' })
    expect(failed?.error).toEqual(expect.any(String))
    expect(String(failed?.error).length).toBeGreaterThan(0)
    expect(failed).not.toHaveProperty('result')
  })

  it('таймаут задачи отменяет агента и помечает задачу failed', async () => {
    vi.stubEnv('SUMMARY_TIMEOUT_MS', '50')
    const prisma = prismaMock()
    const agent = abortableAgent()

    await new SummaryRunner(prisma as never, agent as never, noTranscripts() as never).run(
      'meeting-1',
    )

    const signal = agent.run.mock.calls[0][1]
    expect(signal.aborted).toBe(true)
    const failed = lastWrite(prisma)
    expect(failed).toMatchObject({ status: 'failed' })
    expect(String(failed?.error)).toMatch(/врем|таймаут|timeout/i)
    expect(failed).not.toHaveProperty('result')
  })

  it('таймаут срабатывает, даже если агент не реагирует на отмену', async () => {
    vi.stubEnv('SUMMARY_TIMEOUT_MS', '50')
    const prisma = prismaMock()
    const agent = { run: vi.fn(() => new Promise(() => {})) }

    const started = Date.now()
    await new SummaryRunner(prisma as never, agent as never, noTranscripts() as never).run(
      'meeting-1',
    )

    expect(Date.now() - started).toBeLessThan(2_000)
    expect(lastWrite(prisma)).toMatchObject({ status: 'failed' })
  })

  it('не падает, если БД недоступна при записи результата', async () => {
    const prisma = prismaMock()
    prisma.meetingSummary.update.mockRejectedValue(new Error('db down'))
    prisma.meetingSummary.updateMany.mockRejectedValue(new Error('db down'))
    const agent = { run: vi.fn().mockResolvedValue(RESULT) }

    await expect(
      new SummaryRunner(prisma as never, agent as never, noTranscripts() as never).run('meeting-1'),
    ).resolves.toBeUndefined()
  })

  it('отменяет текущие задачи при остановке приложения', async () => {
    const prisma = prismaMock()
    const agent = abortableAgent()
    const runner = new SummaryRunner(prisma as never, agent as never, noTranscripts() as never)

    const running = runner.run('meeting-1')
    await vi.waitFor(() => expect(agent.run).toHaveBeenCalled())
    await runner.onModuleDestroy()
    await running

    expect(agent.run.mock.calls[0][1].aborted).toBe(true)
  })

  it('генерирует не больше SUMMARY_CONCURRENCY задач одновременно, остальные ждут в pending', async () => {
    vi.stubEnv('SUMMARY_CONCURRENCY', '1')
    const prisma = prismaMock()
    const finishers: (() => void)[] = []
    const agent = {
      run: vi.fn<(meetingId: string) => Promise<unknown>>(
        () =>
          new Promise((resolve) => {
            finishers.push(() => resolve(RESULT))
          }),
      ),
    }
    const runner = new SummaryRunner(prisma as never, agent as never, noTranscripts() as never)

    const first = runner.run('meeting-1')
    const second = runner.run('meeting-2')
    await vi.waitFor(() => expect(agent.run).toHaveBeenCalledTimes(1))
    // вторая задача ещё в очереди: в generating не переводилась
    expect(writes(prisma)).toEqual([{ status: 'generating' }])

    finishers[0]()
    await first
    await vi.waitFor(() => expect(agent.run).toHaveBeenCalledTimes(2))
    expect(agent.run.mock.calls[1][0]).toBe('meeting-2')
    finishers[1]()
    await second
    expect(writes(prisma).map((data) => data.status)).toEqual([
      'generating',
      'done',
      'generating',
      'done',
    ])
  })

  it('задача, отменённая в очереди, помечается failed из pending и не запускает агента', async () => {
    vi.stubEnv('SUMMARY_CONCURRENCY', '1')
    const prisma = prismaMock()
    const agent = abortableAgent()
    const runner = new SummaryRunner(prisma as never, agent as never, noTranscripts() as never)

    const first = runner.run('meeting-1')
    const queued = runner.run('meeting-2')
    await vi.waitFor(() => expect(agent.run).toHaveBeenCalledTimes(1))
    await runner.onModuleDestroy()
    await Promise.all([first, queued])

    expect(agent.run).toHaveBeenCalledTimes(1)
    expect(prisma.meetingSummary.updateMany).toHaveBeenCalledWith({
      where: { meetingId: 'meeting-2', status: 'pending' },
      data: expect.objectContaining({ status: 'failed' }) as unknown,
    })
  })

  it('cancel отменяет только задачу удалённой встречи', async () => {
    const prisma = prismaMock()
    vi.stubEnv('SUMMARY_CONCURRENCY', '2')
    const agent = abortableAgent()
    const runner = new SummaryRunner(prisma as never, agent as never, noTranscripts() as never)

    const deleted = runner.run('meeting-1')
    void runner.run('meeting-2')
    await vi.waitFor(() => expect(agent.run).toHaveBeenCalledTimes(2))
    await runner.cancel('meeting-1')
    await deleted

    const signalOf = (meetingId: string) =>
      agent.run.mock.calls.find(([id]) => id === meetingId)?.[1]
    expect(signalOf('meeting-1')?.aborted).toBe(true)
    expect(signalOf('meeting-2')?.aborted).toBe(false)
    await runner.onModuleDestroy()
  })
})

// этап `transcribing` (фаза 7): транскрибатор вызывается до агента в том же слоте генерации
describe('SummaryRunner: транскрибация', () => {
  const TRANSCRIPTS = [{ fileId: 'f-mp3', name: 'call.mp3', text: 'Решили выпустить релиз.' }]

  type Prepare = (
    meetingId: string,
    signal: AbortSignal,
    onTranscribing: () => Promise<void>,
  ) => Promise<unknown>

  // транскрибатор, которому есть что транскрибировать: сообщает о начале этапа
  const transcribingTranscriber = () => ({
    prepare: vi.fn<Prepare>(async (_meetingId, _signal, onTranscribing) => {
      await onTranscribing()
      return TRANSCRIPTS
    }),
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('pending → transcribing → generating → done, агент получает транскрипты', async () => {
    const prisma = prismaMock()
    const agent = { run: vi.fn().mockResolvedValue(RESULT) }
    const transcriber = transcribingTranscriber()

    await new SummaryRunner(prisma as never, agent as never, transcriber as never).run('meeting-1')

    expect(transcriber.prepare).toHaveBeenCalledWith(
      'meeting-1',
      expect.any(AbortSignal),
      expect.any(Function),
    )
    expect(agent.run).toHaveBeenCalledWith('meeting-1', expect.any(AbortSignal), TRANSCRIPTS)
    expect(writes(prisma).map((data) => data.status)).toEqual([
      'transcribing',
      'generating',
      'done',
    ])
    // каждый переход — только из своего предыдущего статуса
    expect(prisma.meetingSummary.updateMany).toHaveBeenCalledWith({
      where: { meetingId: 'meeting-1', status: 'pending' },
      data: { status: 'transcribing' },
    })
    expect(prisma.meetingSummary.updateMany).toHaveBeenCalledWith({
      where: { meetingId: 'meeting-1', status: 'transcribing' },
      data: { status: 'generating' },
    })
  })

  it('нечего транскрибировать (нет медиа или транскрипты уже есть) — сразу generating', async () => {
    const prisma = prismaMock()
    const agent = { run: vi.fn().mockResolvedValue(RESULT) }
    const transcriber = { prepare: vi.fn<Prepare>().mockResolvedValue(TRANSCRIPTS) }

    await new SummaryRunner(prisma as never, agent as never, transcriber as never).run('meeting-1')

    expect(writes(prisma).map((data) => data.status)).toEqual(['generating', 'done'])
    expect(agent.run).toHaveBeenCalledWith('meeting-1', expect.any(AbortSignal), TRANSCRIPTS)
  })

  it('ошибка транскрибации → failed с её текстом из transcribing, агент не запускается', async () => {
    const prisma = prismaMock()
    const agent = { run: vi.fn().mockResolvedValue(RESULT) }
    const message = 'Не удалось транскрибировать call.mp3: сервис транскрибации недоступен'
    const transcriber = {
      prepare: vi.fn<Prepare>(async (_meetingId, _signal, onTranscribing) => {
        await onTranscribing()
        throw new TranscriptionError(message)
      }),
    }

    await new SummaryRunner(prisma as never, agent as never, transcriber as never).run('meeting-1')

    expect(agent.run).not.toHaveBeenCalled()
    expect(prisma.meetingSummary.updateMany).toHaveBeenLastCalledWith({
      where: { meetingId: 'meeting-1', status: 'transcribing' },
      data: { status: 'failed', error: message },
    })
  })

  // транскрибатор, который висит, пока его не отменят
  const hangingTranscriber = () => ({
    prepare: vi.fn<Prepare>(async (_meetingId, signal, onTranscribing) => {
      await onTranscribing()
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    }),
  })

  it('удаление встречи (cancel) во время транскрибации отменяет её', async () => {
    const prisma = prismaMock()
    const agent = { run: vi.fn().mockResolvedValue(RESULT) }
    const transcriber = hangingTranscriber()
    const runner = new SummaryRunner(prisma as never, agent as never, transcriber as never)

    const running = runner.run('meeting-1')
    await vi.waitFor(() => expect(transcriber.prepare).toHaveBeenCalled())
    await runner.cancel('meeting-1')
    await running

    expect(transcriber.prepare.mock.calls[0][1].aborted).toBe(true)
    expect(agent.run).not.toHaveBeenCalled()
  })

  it('SUMMARY_TIMEOUT_MS ограничивает и транскрибацию: зависший Whisper → failed', async () => {
    vi.stubEnv('SUMMARY_TIMEOUT_MS', '50')
    const prisma = prismaMock()
    const agent = { run: vi.fn().mockResolvedValue(RESULT) }
    const transcriber = hangingTranscriber()

    await new SummaryRunner(prisma as never, agent as never, transcriber as never).run('meeting-1')

    expect(transcriber.prepare.mock.calls[0][1].aborted).toBe(true)
    expect(agent.run).not.toHaveBeenCalled()
    const failed = lastWrite(prisma)
    expect(failed).toMatchObject({ status: 'failed' })
    expect(String(failed?.error)).toMatch(/врем|таймаут/i)
  })

  it('транскрибация занимает слот SUMMARY_CONCURRENCY: вторая задача ждёт в pending', async () => {
    vi.stubEnv('SUMMARY_CONCURRENCY', '1')
    const prisma = prismaMock()
    const agent = { run: vi.fn().mockResolvedValue(RESULT) }
    const transcriber = hangingTranscriber()
    const runner = new SummaryRunner(prisma as never, agent as never, transcriber as never)

    const first = runner.run('meeting-1')
    const second = runner.run('meeting-2')
    await vi.waitFor(() => expect(transcriber.prepare).toHaveBeenCalledTimes(1))
    // пока Whisper занят первой встречей, вторая не начинается
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(transcriber.prepare).toHaveBeenCalledTimes(1)

    await runner.onModuleDestroy()
    await Promise.all([first, second])
  })

  it('остановка api во время транскрибации отменяет её и помечает задачу failed', async () => {
    const prisma = prismaMock()
    const agent = { run: vi.fn().mockResolvedValue(RESULT) }
    const transcriber = {
      prepare: vi.fn<Prepare>(async (_meetingId, signal, onTranscribing) => {
        await onTranscribing()
        return new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
      }),
    }
    const runner = new SummaryRunner(prisma as never, agent as never, transcriber as never)

    const running = runner.run('meeting-1')
    await vi.waitFor(() => expect(writes(prisma)).toEqual([{ status: 'transcribing' }]))
    await runner.onModuleDestroy()
    await running

    expect(transcriber.prepare.mock.calls[0][1].aborted).toBe(true)
    expect(agent.run).not.toHaveBeenCalled()
    expect(lastWrite(prisma)).toMatchObject({ status: 'failed' })
  })
})
