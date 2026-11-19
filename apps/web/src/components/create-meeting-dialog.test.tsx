import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateMeetingDialog } from './create-meeting-dialog'

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const fetchMock = vi.fn()

// Часовой пояс «браузера» UTC+5 без летнего времени: перевод в UTC виден в теле запроса
const originalTz = process.env.TZ
beforeAll(() => {
  process.env.TZ = 'Asia/Yekaterinburg'
})
afterAll(() => {
  process.env.TZ = originalTz
})

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  router.push.mockReset()
  router.refresh.mockReset()
  router.replace.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// Подменяется только Date: таймеры user-event и React Aria остаются настоящими
const setNow = (date: Date) => vi.useFakeTimers({ toFake: ['Date'], now: date })

const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as Response

const created = {
  id: 'm1',
  title: 'Планёрка',
  date: '2030-01-15T10:00:00.000Z',
  participants: [],
  ownerId: 'u1',
}

// Сегмент поля даты или времени (React Aria: role="spinbutton", тип в data-type) — не зависит
// от порядка сегментов в локали
const segment = (field: 'Дата' | 'Время', type: 'day' | 'month' | 'year' | 'hour' | 'minute') => {
  const group = screen.getAllByRole('group', { name: field })[0]
  const found = within(group)
    .getAllByRole('spinbutton')
    .find((element) => element.dataset.type === type)
  if (!found) throw new Error(`Нет сегмента ${type} в поле «${field}»`)
  return found
}

const openDialog = async () => {
  const user = userEvent.setup()
  render(<CreateMeetingDialog />)
  await user.click(screen.getByRole('button', { name: 'Создать встречу' }))
  return { user, dialog: await screen.findByRole('dialog') }
}

const submitTitle = async (user: ReturnType<typeof userEvent.setup>, title: string) => {
  const input = screen.getByRole('textbox', { name: 'Название' })
  await user.clear(input)
  // вставка, а не набор: так без искажений доходят управляющие символы и длинная строка
  if (title) {
    await user.click(input)
    await user.paste(title)
  }
  await user.click(screen.getByRole('button', { name: 'Создать' }))
}

describe('CreateMeetingDialog', () => {
  it('окно закрыто, пока не нажата кнопка «Создать встречу»', () => {
    render(<CreateMeetingDialog />)

    expect(screen.getByRole('button', { name: 'Создать встречу' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('кнопка открывает окно с полями «Название», «Дата», «Время»', async () => {
    const { dialog } = await openDialog()

    expect(within(dialog).getByRole('heading', { name: 'Новая встреча' })).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: 'Название' })).toBeInTheDocument()
    expect(within(dialog).getAllByRole('group', { name: 'Дата' }).length).toBeGreaterThan(0)
    expect(within(dialog).getAllByRole('group', { name: 'Время' }).length).toBeGreaterThan(0)
    expect(within(dialog).getByRole('button', { name: 'Создать' })).toBeInTheDocument()
  })

  it('по умолчанию — сегодня и ближайший следующий целый час', async () => {
    setNow(new Date(2030, 0, 15, 14, 20))
    await openDialog()

    expect(segment('Дата', 'day')).toHaveAttribute('aria-valuenow', '15')
    expect(segment('Дата', 'month')).toHaveAttribute('aria-valuenow', '1')
    expect(segment('Дата', 'year')).toHaveAttribute('aria-valuenow', '2030')
    expect(segment('Время', 'hour')).toHaveAttribute('aria-valuenow', '15')
    expect(segment('Время', 'minute')).toHaveAttribute('aria-valuenow', '0')
  })

  it('после 23:00 по умолчанию — полночь следующего дня', async () => {
    setNow(new Date(2030, 0, 15, 23, 30))
    await openDialog()

    expect(segment('Дата', 'day')).toHaveAttribute('aria-valuenow', '16')
    expect(segment('Время', 'hour')).toHaveAttribute('aria-valuenow', '0')
    expect(segment('Время', 'minute')).toHaveAttribute('aria-valuenow', '0')
  })

  it('выбранные 15:00 по времени браузера уходят в API моментом в UTC; успех ведёт на страницу встречи', async () => {
    setNow(new Date(2030, 0, 15, 9, 10))
    fetchMock.mockResolvedValue(jsonResponse(201, created))
    const { user } = await openDialog()

    await user.click(segment('Время', 'hour'))
    await user.keyboard('15')
    expect(segment('Время', 'hour')).toHaveAttribute('aria-valuenow', '15')
    await submitTitle(user, '  Планёрка  ')

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/meetings/m1'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/meetings')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      title: 'Планёрка',
      date: '2030-01-15T10:00:00.000Z',
      participants: [],
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('после создания обновляет данные страниц: главная покажет новый счётчик и встречу', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, created))
    const { user } = await openDialog()

    await submitTitle(user, 'Планёрка')

    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1))
    // refresh сразу после push: Next обновляет уже новую страницу и сбрасывает данные скрытой главной
    expect(router.push.mock.invocationCallOrder[0]).toBeLessThan(
      router.refresh.mock.invocationCallOrder[0],
    )
  })

  it('выбранная дата тоже переводится: 16.01 02:00 (UTC+5) — 15.01 21:00 UTC', async () => {
    setNow(new Date(2030, 0, 15, 9, 10))
    fetchMock.mockResolvedValue(jsonResponse(201, created))
    const { user } = await openDialog()

    await user.click(segment('Дата', 'day'))
    await user.keyboard('16')
    await user.click(segment('Время', 'hour'))
    await user.keyboard('02')
    await submitTitle(user, 'Ночной релиз')

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({ date: '2030-01-15T21:00:00.000Z' })
  })

  it.each([
    ['пустое название', '', 'Введите название'],
    ['название из пробелов', '   ', 'Введите название'],
    ['название длиннее 200 символов', 'я'.repeat(201), 'Название не длиннее 200 символов'],
    [
      'название с управляющими символами',
      'План\u0007ёрка',
      'Название содержит недопустимые символы',
    ],
  ])('%s не отправляется, у поля ошибка', async (_, title, message) => {
    const { user, dialog } = await openDialog()
    await submitTitle(user, title)

    expect(await within(dialog).findByText(message)).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: 'Название' })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(router.push).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('ответ без id не ведёт на /meetings/undefined: окно остаётся с ошибкой', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, {}))
    const { user, dialog } = await openDialog()

    await submitTitle(user, 'Планёрка')

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Что-то пошло не так')
    expect(router.push).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it.each([
    ['Дата', 'year', 'Укажите дату'],
    ['Время', 'minute', 'Укажите время'],
  ] as const)('стёртое поле «%s» не отправляется, у поля ошибка', async (field, last, message) => {
    const { user, dialog } = await openDialog()

    // React Aria отдаёт null, только когда стёрты все сегменты; Backspace на пустом сегменте
    // переводит фокус на предыдущий, поэтому стираем с последнего
    await user.click(segment(field, last))
    await user.keyboard('{Backspace}'.repeat(12))
    await submitTitle(user, 'Планёрка')

    expect(await within(dialog).findByText(message)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
