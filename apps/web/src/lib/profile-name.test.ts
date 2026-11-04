import { NAME_MAX_LENGTH, validateName } from './profile-name'

describe('validateName', () => {
  it.each([
    ['Иван Петров'],
    ['Mary-Jane O’Neil'],
    ['李小龍'],
    ['Алекс 2'],
    ['👩‍💻 Ann'],
    ['  Иван  '],
  ])('принимает %j', (value) => {
    expect(validateName(value)).toBeNull()
  })

  it.each([[''], ['   '], ['\t\n']])('требует ввести имя для %j', (value) => {
    expect(validateName(value)).toBe('Введите имя')
  })

  it('принимает имя в 100 символов и отклоняет 101 (после обрезки пробелов)', () => {
    expect(validateName(` ${'я'.repeat(NAME_MAX_LENGTH)} `)).toBeNull()
    expect(validateName('я'.repeat(NAME_MAX_LENGTH + 1))).toBe('Имя не длиннее 100 символов')
  })

  it('считает длину в символах, а не в единицах UTF-16 (как class-validator в API)', () => {
    // 60 символов = 119 единиц UTF-16; буква нужна, имя только из эмодзи не принимается
    expect(validateName(`a${'😀'.repeat(59)}`)).toBeNull()
    expect(validateName(`a${'😀'.repeat(99)}`)).toBeNull()
    expect(validateName(`a${'😀'.repeat(100)}`)).toBe('Имя не длиннее 100 символов')
    expect(validateName('𠮷'.repeat(100))).toBeNull()
  })

  it('отклоняет управляющие символы', () => {
    expect(validateName('a\u0000b')).toBe('Имя содержит недопустимые символы')
    expect(validateName('a\nb')).toBe('Имя содержит недопустимые символы')
  })

  it.each([['​'], ['​‍⁠'], ['...'], ['🙂']])('отклоняет имя без буквы и цифры: %j', (value) => {
    expect(validateName(value)).toBe('Имя должно содержать букву или цифру')
  })
})
