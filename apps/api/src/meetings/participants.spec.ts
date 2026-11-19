import { uniqueParticipants } from './participants.js'

describe('uniqueParticipants', () => {
  it('убирает повторы без учёта регистра, сохраняя первое написание и порядок', () => {
    expect(uniqueParticipants(['Алиса', 'Боб', 'алиса', 'БОБ', 'Кэрол', 'АЛИСА'])).toEqual([
      'Алиса',
      'Боб',
      'Кэрол',
    ])
  })

  it('не учитывает пробелы по краям при сравнении', () => {
    expect(uniqueParticipants(['Алиса', ' алиса '])).toEqual(['Алиса'])
  })

  it('считает одинаковыми составную и разложенную формы одной буквы', () => {
    // «й» одним символом и «и» + комбинирующая кратка
    expect(uniqueParticipants(['Йоко', 'Йоко'])).toEqual(['Йоко'])
  })

  it('не различает имена с невидимыми символами, лишними пробелами и совместимыми формами', () => {
    expect(
      uniqueParticipants([
        'Алиса',
        'Алиса​',
        'Ал­иса',
        'Анна Петрова',
        'Анна  Петрова',
        'Анна Петрова',
        'Alice',
        'Ａｌｉｃｅ',
        'Straße',
        'STRASSE',
      ]),
    ).toEqual(['Алиса', 'Анна Петрова', 'Alice', 'Straße'])
  })

  it('возвращает первое написание без пробелов по краям', () => {
    expect(uniqueParticipants([' Алиса ', 'алиса'])).toEqual(['Алиса'])
  })

  it('оставляет разные имена и пустой список как есть', () => {
    expect(uniqueParticipants(['bob@example.com', 'carol@example.com'])).toEqual([
      'bob@example.com',
      'carol@example.com',
    ])
    expect(uniqueParticipants([])).toEqual([])
  })
})
