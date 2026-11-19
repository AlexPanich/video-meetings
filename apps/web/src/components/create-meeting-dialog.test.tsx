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

const participantInput = () => screen.getByRole('textbox', { name: 'Участники' })

// Теги участников — строки сетки TagGroup (React Aria) с подписью «Участники»
const tags = () => {
  const grid = screen.queryByRole('grid', { name: 'Участники' })
  if (!grid) return []
  return within(grid)
    .queryAllByRole('row')
    .map((row) => row.textContent?.trim())
}

// Вставка, а не набор: так без искажений доходят управляющие символы и длинная строка
const pasteParticipant = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(participantInput())
  await user.paste(name)
}

const sentBody = () => {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  return JSON.parse(String(init.body)) as { participants: string[] }
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

  describe('участники', () => {
    it('Enter превращает имя в тег и очищает ввод, форма при этом не отправляется', async () => {
      const { user } = await openDialog()

      await user.type(participantInput(), '  Анна Петрова  {Enter}')

      expect(tags()).toEqual(['Анна Петрова'])
      expect(participantInput()).toHaveValue('')
      expect(fetchMock).not.toHaveBeenCalled()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('запятая превращает имя в тег и очищает ввод', async () => {
      const { user } = await openDialog()

      await user.type(participantInput(), 'Анна,Борис,')

      expect(tags()).toEqual(['Анна', 'Борис'])
      expect(participantInput()).toHaveValue('')
    })

    it('вставка «Анна, Борис, Вера» — теги до последней запятой, остаток в поле', async () => {
      const { user } = await openDialog()

      await pasteParticipant(user, 'Анна, Борис, Вера')

      expect(tags()).toEqual(['Анна', 'Борис'])
      expect(participantInput()).toHaveValue(' Вера')
    })

    it('пустой ввод по Enter тег не добавляет', async () => {
      const { user } = await openDialog()

      await user.type(participantInput(), '   {Enter}')

      expect(tags()).toEqual([])
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('крестик удаляет тег', async () => {
      const { user } = await openDialog()
      await user.type(participantInput(), 'Анна{Enter}Борис{Enter}')

      await user.click(screen.getByRole('button', { name: 'Удалить Анна' }))

      expect(tags()).toEqual(['Борис'])
    })

    it('Backspace в пустом поле удаляет последний тег, в непустом — только символ', async () => {
      const { user } = await openDialog()
      await user.type(participantInput(), 'Анна{Enter}Борис{Enter}Ве')

      await user.keyboard('{Backspace}')
      expect(tags()).toEqual(['Анна', 'Борис'])
      expect(participantInput()).toHaveValue('В')

      await user.keyboard('{Backspace}{Backspace}')
      expect(tags()).toEqual(['Анна'])
      expect(participantInput()).toHaveValue('')
    })

    it.each([
      ['другой регистр', 'АННА ПЕТРОВА'],
      ['пробелы по краям и внутри', '  анна   петрова  '],
    ])('повтор (%s) тег не добавляет, причина показывается', async (_, name) => {
      const { user, dialog } = await openDialog()
      await user.type(participantInput(), 'Анна Петрова{Enter}')

      await user.type(participantInput(), `${name}{Enter}`)

      expect(tags()).toEqual(['Анна Петрова'])
      expect(
        await within(dialog).findByText('Участник «Анна Петрова» уже добавлен'),
      ).toBeInTheDocument()
      expect(participantInput()).toHaveAttribute('aria-invalid', 'true')
    })

    it.each([
      ['длиннее 100 символов', 'я'.repeat(101), 'Имя участника не длиннее 100 символов'],
      ['с управляющими символами', 'Ан\u0007на', 'Имя участника содержит недопустимые символы'],
    ])('имя %s не добавляется, причина показывается', async (_, name, message) => {
      const { user, dialog } = await openDialog()

      await pasteParticipant(user, name)
      await user.keyboard('{Enter}')

      expect(tags()).toEqual([])
      expect(await within(dialog).findByText(message)).toBeInTheDocument()
      expect(participantInput()).toHaveAttribute('aria-invalid', 'true')
      // ввод остаётся, чтобы его можно было исправить
      expect(participantInput()).toHaveValue(name)
    })

    it('ошибка снимается, когда ввод меняется', async () => {
      const { user, dialog } = await openDialog()
      await pasteParticipant(user, 'я'.repeat(101))
      await user.keyboard('{Enter}')
      await within(dialog).findByText('Имя участника не длиннее 100 символов')

      await user.keyboard('{Backspace}')

      expect(
        within(dialog).queryByText('Имя участника не длиннее 100 символов'),
      ).not.toBeInTheDocument()
      expect(participantInput()).not.toHaveAttribute('aria-invalid', 'true')
    })

    it('51-й участник не добавляется, причина показывается', async () => {
      const { user, dialog } = await openDialog()
      const fifty = Array.from({ length: 50 }, (_, i) => `Участник ${i + 1}`)
      await pasteParticipant(user, `${fifty.join(',')},`)
      expect(tags()).toHaveLength(50)

      await user.type(participantInput(), 'Лишний{Enter}')

      expect(tags()).toHaveLength(50)
      expect(await within(dialog).findByText('Участников не больше 50')).toBeInTheDocument()
    })

    it('теги и невписанное в тег имя уходят в запрос создания', async () => {
      fetchMock.mockResolvedValue(jsonResponse(201, created))
      const { user } = await openDialog()
      await user.type(participantInput(), 'Анна{Enter}Борис,')
      await user.type(participantInput(), '  Вера  ')

      await submitTitle(user, 'Планёрка')

      await waitFor(() => expect(router.push).toHaveBeenCalledWith('/meetings/m1'))
      expect(sentBody().participants).toEqual(['Анна', 'Борис', 'Вера'])
    })

    it('без участников уходит пустой список', async () => {
      fetchMock.mockResolvedValue(jsonResponse(201, created))
      const { user } = await openDialog()
      await user.type(participantInput(), '   ')

      await submitTitle(user, 'Планёрка')

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      expect(sentBody().participants).toEqual([])
    })

    it('невписанный повтор при отправке не дублируется', async () => {
      fetchMock.mockResolvedValue(jsonResponse(201, created))
      const { user } = await openDialog()
      await user.type(participantInput(), 'Анна{Enter}анна')

      await submitTitle(user, 'Планёрка')

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      expect(sentBody().participants).toEqual(['Анна'])
    })

    it.each([
      ['длиннее 100 символов', 'я'.repeat(101), 'Имя участника не длиннее 100 символов'],
      ['с управляющими символами', 'Ан\u0007на', 'Имя участника содержит недопустимые символы'],
    ])(
      'невписанное имя %s не даёт отправить форму, причина показывается',
      async (_, name, message) => {
        const { user, dialog } = await openDialog()
        await pasteParticipant(user, name)

        await submitTitle(user, 'Планёрка')

        expect(await within(dialog).findByText(message)).toBeInTheDocument()
        expect(fetchMock).not.toHaveBeenCalled()
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      },
    )

    it('невписанное 51-е имя не даёт отправить форму', async () => {
      const { user, dialog } = await openDialog()
      const fifty = Array.from({ length: 50 }, (_, i) => `Участник ${i + 1}`)
      await pasteParticipant(user, `${fifty.join(',')},Лишний`)

      await submitTitle(user, 'Планёрка')

      expect(await within(dialog).findByText('Участников не больше 50')).toBeInTheDocument()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('ошибка повтора у поля не мешает отправить форму: повтор не дублируется', async () => {
      fetchMock.mockResolvedValue(jsonResponse(201, created))
      const { user, dialog } = await openDialog()
      await user.type(participantInput(), 'Анна{Enter}анна{Enter}')
      await within(dialog).findByText('Участник «Анна» уже добавлен')

      await submitTitle(user, 'Планёрка')

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      expect(sentBody().participants).toEqual(['Анна'])
    })

    it('остаток вставки с запятыми после ошибки при отправке режется на имена', async () => {
      fetchMock.mockResolvedValue(jsonResponse(201, created))
      const { user } = await openDialog()
      await user.type(participantInput(), 'Анна{Enter}')
      await pasteParticipant(user, 'Анна, Борис, Вера')
      expect(participantInput()).toHaveValue('Анна, Борис, Вера')

      await user.click(screen.getByRole('button', { name: 'Удалить Анна' }))
      await submitTitle(user, 'Планёрка')

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      expect(sentBody().participants).toEqual(['Анна', 'Борис', 'Вера'])
    })

    it('удаление тега не снимает ошибку, которую оно не исправляет', async () => {
      const { user, dialog } = await openDialog()
      await user.type(participantInput(), 'Анна{Enter}')
      await pasteParticipant(user, 'я'.repeat(101))
      await user.keyboard('{Enter}')
      await within(dialog).findByText('Имя участника не длиннее 100 символов')

      await user.click(screen.getByRole('button', { name: 'Удалить Анна' }))

      expect(within(dialog).getByText('Имя участника не длиннее 100 символов')).toBeInTheDocument()
    })

    it('ошибка участников от API показывается в окне, даже если она не первая', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(400, {
          statusCode: 400,
          message: [
            'Название должно быть не длиннее 200 символов',
            'Имя участника содержит недопустимые символы',
          ],
        }),
      )
      const { user, dialog } = await openDialog()
      await user.type(participantInput(), 'Анна{Enter}')

      await submitTitle(user, 'Планёрка')

      const alert = await within(dialog).findByRole('alert')
      expect(alert).toHaveTextContent('Название должно быть не длиннее 200 символов')
      expect(alert).toHaveTextContent('Имя участника содержит недопустимые символы')
      expect(router.push).not.toHaveBeenCalled()
      // введённые участники не теряются
      expect(tags()).toEqual(['Анна'])
    })

    it('при повторном открытии окна участники и ввод сброшены', async () => {
      const { user } = await openDialog()
      await user.type(participantInput(), 'Анна{Enter}Бо')
      await user.click(screen.getByRole('button', { name: 'Отмена' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: 'Создать встречу' }))
      await screen.findByRole('dialog')

      expect(tags()).toEqual([])
      expect(participantInput()).toHaveValue('')
    })
  })
})
