import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { UpdateProfileDto } from '../profile/dto.js'

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

  it('отклоняет имя без буквы и цифры, пустое и слишком длинное', async () => {
    await expect(errorsFor('!!!')).resolves.toContain('name должно содержать букву или цифру')
    await expect(errorsFor('   ')).resolves.not.toEqual([])
    await expect(errorsFor('a'.repeat(101))).resolves.not.toEqual([])
  })
})
