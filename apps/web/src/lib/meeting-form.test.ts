import {
  MEETING_TITLE_MAX_LENGTH,
  defaultMeetingStart,
  localDateTimeToIso,
  validateMeetingTitle,
} from './meeting-form'

// Часовой пояс «браузера» с ненулевым смещением (UTC+5, без перехода на летнее время):
// так перевод в UTC заметен в ожиданиях. Node перечитывает TZ при присваивании.
const originalTz = process.env.TZ
beforeAll(() => {
  process.env.TZ = 'Asia/Yekaterinburg'
})
afterAll(() => {
  process.env.TZ = originalTz
})

describe('validateMeetingTitle', () => {
  it.each([
    ['пустое', ''],
    ['из пробелов', '   '],
    ['из невидимых символов', '​​'],
  ])('название %s — «Введите название»', (_, value) => {
    expect(validateMeetingTitle(value)).toBe('Введите название')
  })

  it('длиннее 200 символов после обрезки — ошибка длины', () => {
    expect(validateMeetingTitle('я'.repeat(MEETING_TITLE_MAX_LENGTH + 1))).toBe(
      'Название не длиннее 200 символов',
    )
  })

  it('ровно 200 символов, пробелы по краям не считаются', () => {
    expect(validateMeetingTitle(`  ${'я'.repeat(MEETING_TITLE_MAX_LENGTH)}  `)).toBeNull()
  })

  it('длина в символах, а не в единицах UTF-16: 200 эмодзи допустимы', () => {
    expect(validateMeetingTitle('😀'.repeat(MEETING_TITLE_MAX_LENGTH))).toBeNull()
  })

  it.each([
    ['управляющим символом', 'План\u0007ёрка'],
    ['переводом строки', 'План\nёрка'],
    ['bidi-символом', 'План‮ёрка'],
  ])('название с %s — недопустимые символы', (_, value) => {
    expect(validateMeetingTitle(value)).toBe('Название содержит недопустимые символы')
  })

  it('обычное название допустимо', () => {
    expect(validateMeetingTitle('Планёрка команды')).toBeNull()
  })
})

describe('defaultMeetingStart', () => {
  it('сегодня и следующий целый час', () => {
    expect(defaultMeetingStart(new Date(2030, 0, 15, 14, 20))).toEqual({
      date: '2030-01-15',
      time: '15:00',
    })
  })

  it('ровно в начале часа — следующий час, а не текущий', () => {
    expect(defaultMeetingStart(new Date(2030, 0, 15, 14, 0, 0))).toEqual({
      date: '2030-01-15',
      time: '15:00',
    })
  })

  it('после 23:00 — полночь следующего дня', () => {
    expect(defaultMeetingStart(new Date(2030, 0, 15, 23, 30))).toEqual({
      date: '2030-01-16',
      time: '00:00',
    })
  })

  it('переход через полночь в последний день года', () => {
    expect(defaultMeetingStart(new Date(2030, 11, 31, 23, 5))).toEqual({
      date: '2031-01-01',
      time: '00:00',
    })
  })
})

describe('localDateTimeToIso', () => {
  it('15:00 по времени браузера (UTC+5) — 10:00 UTC', () => {
    expect(localDateTimeToIso('2030-01-15', '15:00')).toBe('2030-01-15T10:00:00.000Z')
  })

  it('секунды во времени отбрасываются (так `Time.toString()` отдаёт поле времени)', () => {
    expect(localDateTimeToIso('2030-01-15', '15:00:00')).toBe('2030-01-15T10:00:00.000Z')
  })

  it('годы 0–99 не превращаются в 1900-е', () => {
    // смещение пояса в древние годы историческое (LMT), поэтому проверяется только дата
    expect(localDateTimeToIso('0025-01-15', '15:00')).toMatch(/^0025-01-15T/)
  })

  it('раннее утро по местному времени — предыдущий день в UTC', () => {
    expect(localDateTimeToIso('2030-01-15', '02:30')).toBe('2030-01-14T21:30:00.000Z')
  })
})
