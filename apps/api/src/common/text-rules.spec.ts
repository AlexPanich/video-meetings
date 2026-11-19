import { NAME_ALLOWED_PATTERN, NAME_ALLOWED_SCHEMA_PATTERN, VISIBLE_TEXT } from './text-rules.js'

describe('text-rules', () => {
  it('шаблон для схемы Swagger без флага u совпадает с серверным на всех символах', () => {
    const server = new RegExp(NAME_ALLOWED_PATTERN, 'u')
    // так шаблон из OpenAPI компилируют клиенты (Ajv по умолчанию, генераторы): без флага `u`
    const schema = new RegExp(NAME_ALLOWED_SCHEMA_PATTERN)
    for (let code = 0; code <= 0xffff; code++) {
      if (code >= 0xd800 && code <= 0xdfff) continue // одиночные суррогаты — не символы
      const char = String.fromCharCode(code)
      if (schema.test(char) !== server.test(char)) {
        throw new Error(`Шаблоны расходятся на U+${code.toString(16).toUpperCase()}`)
      }
    }
    // за пределами BMP запрещённых символов нет: суррогатные пары пропускают оба шаблона
    expect(schema.test('👨‍👩‍👧')).toBe(server.test('👨‍👩‍👧'))
  })

  it.each([
    ['пробелы', '  　'],
    ['zero-width space и soft hyphen', '​­'],
    ['одни комбинирующие знаки', '́́'],
    ['Hangul Filler', 'ㅤ'],
    ['Hangul Choseong/Jungseong Filler', 'ᅟᅠ'],
    ['полуширинный Hangul Filler', 'ﾠ'],
    ['пустой символ Брайля', '⠀'],
  ])('VISIBLE_TEXT не находит видимого символа: %s', (_title, text) => {
    expect(VISIBLE_TEXT.test(text)).toBe(false)
  })

  it.each(['!!!', 'é', 'é', 'Анна', '👍', '한'])('VISIBLE_TEXT находит видимый символ в %j', (text) => {
    expect(VISIBLE_TEXT.test(text)).toBe(true)
  })
})
