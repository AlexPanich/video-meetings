import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { UpdateProfileDto } from '../profile/dto.js'
import { NAME_ALLOWED_PATTERN, NAME_ALLOWED_SCHEMA_PATTERN } from './user-name.js'

const errorsFor = async (name: unknown) =>
  (await validate(plainToInstance(UpdateProfileDto, { name }))).flatMap((e) =>
    Object.values(e.constraints ?? {}),
  )

describe('IsUserName', () => {
  it.each(['Alice', 'Анна Иванова', 'Ян 2', '👨‍👩‍👧 Семья'])('принимает %s', async (name) => {
    await expect(errorsFor(name)).resolves.toEqual([])
  })

  it.each([
    ['управляющий символ', 'Al\u0000ice'],
    ['RLO U+202E', 'abc‮gnp.exe'],
    ['isolate U+2066', 'Alice⁦'],
    ['pop isolate U+2069', 'Alice⁩'],
    ['LRM U+200E', 'Alice‎'],
  ])('отклоняет: %s', async (_title, name) => {
    await expect(errorsFor(name)).resolves.toContain('name содержит недопустимые символы')
  })

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

  it('отклоняет имя без буквы и цифры, пустое и слишком длинное', async () => {
    await expect(errorsFor('!!!')).resolves.toContain('name должно содержать букву или цифру')
    await expect(errorsFor('   ')).resolves.not.toEqual([])
    await expect(errorsFor('a'.repeat(101))).resolves.not.toEqual([])
  })
})
