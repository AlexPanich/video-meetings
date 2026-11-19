import {
  MEETING_PARTICIPANTS_MAX,
  MEETING_TITLE_MAX_LENGTH,
  PARTICIPANT_NAME_MAX_LENGTH,
  defaultMeetingStart,
  localDateTimeToIso,
  participantKey,
  validateMeetingTitle,
  validateParticipant,
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

  describe('переход на летнее время (Europe/Berlin)', () => {
    beforeEach(() => {
      process.env.TZ = 'Europe/Berlin'
    })
    afterEach(() => {
      process.env.TZ = 'Asia/Yekaterinburg'
    })

    it('несуществующее 02:30 при переводе вперёд сдвигается на 03:30 (01:30 UTC)', () => {
      expect(localDateTimeToIso('2030-03-31', '02:30')).toBe('2030-03-31T01:30:00.000Z')
    })

    it('из двух 02:30 при переводе назад берётся первое, летнее (00:30 UTC)', () => {
      expect(localDateTimeToIso('2030-10-27', '02:30')).toBe('2030-10-27T00:30:00.000Z')
    })
  })
})

// Ключ повтора — как `participantKey` в `apps/api/src/meetings/participants.ts`
describe('participantKey', () => {
  it.each([
    ['регистр', 'Анна Петрова', 'анна петрова'],
    ['пробелы по краям', '  Анна  ', 'Анна'],
    ['несколько пробелов внутри', 'Анна  Петрова', 'Анна Петрова'],
    ['неразрывный пробел', 'Анна Петрова', 'Анна Петрова'],
    ['невидимый символ', 'Ан​на', 'Анна'],
    ['полноширинные буквы (NFKC)', 'ＡＮＮＡ', 'anna'],
    ['ß и SS', 'Straße', 'STRASSE'],
  ])('одинаковый ключ: %s', (_, a, b) => {
    expect(participantKey(a)).toBe(participantKey(b))
  })

  it('разные имена — разные ключи', () => {
    expect(participantKey('Анна')).not.toBe(participantKey('Анна П.'))
  })
})

describe('validateParticipant', () => {
  it('новое имя допустимо', () => {
    expect(validateParticipant('Анна', ['Борис'])).toBeNull()
  })

  it.each([
    ['пустое', ''],
    ['из пробелов', '   '],
    ['из невидимых символов', '​​'],
  ])('имя %s — «Введите имя участника»', (_, value) => {
    expect(validateParticipant(value, [])).toBe('Введите имя участника')
  })

  it.each([
    ['управляющим символом', 'Ан\u0007на'],
    ['переводом строки', 'Ан\nна'],
    ['bidi-символом', 'Ан‮на'],
  ])('имя с %s — недопустимые символы', (_, value) => {
    expect(validateParticipant(value, [])).toBe('Имя участника содержит недопустимые символы')
  })

  it('длиннее 100 символов после обрезки — ошибка длины', () => {
    expect(validateParticipant('я'.repeat(PARTICIPANT_NAME_MAX_LENGTH + 1), [])).toBe(
      'Имя участника не длиннее 100 символов',
    )
  })

  it('ровно 100 символов (эмодзи — один символ), пробелы по краям не считаются', () => {
    expect(validateParticipant(`  ${'😀'.repeat(PARTICIPANT_NAME_MAX_LENGTH)}  `, [])).toBeNull()
  })

  it('повтор без учёта регистра и пробелов — уже добавлен (с написанием из списка)', () => {
    expect(validateParticipant('  анна  ПЕТРОВА ', ['Анна Петрова'])).toBe(
      'Участник «Анна Петрова» уже добавлен',
    )
  })

  it('51-й участник — лимит', () => {
    const fifty = Array.from({ length: MEETING_PARTICIPANTS_MAX }, (_, i) => `Участник ${i + 1}`)
    expect(validateParticipant('Новый', fifty)).toBe('Участников не больше 50')
    expect(validateParticipant('Новый', fifty.slice(1))).toBeNull()
  })
})
