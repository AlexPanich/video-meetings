import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreateMeetingDto } from './dto.js'

const valid = {
  title: 'Планёрка',
  date: '2030-01-15T10:00:00.000Z',
  participants: ['Алиса', 'Боб'],
}

const check = async (overrides: object) => {
  const dto = plainToInstance(CreateMeetingDto, { ...valid, ...overrides })
  const errors = (await validate(dto)).flatMap((e) => Object.values(e.constraints ?? {}))
  return { dto, errors }
}

describe('CreateMeetingDto', () => {
  it('принимает корректную встречу и обрезает пробелы по краям названия и имён', async () => {
    const { dto, errors } = await check({ title: ' Планёрка\t', participants: [' Алиса ', 'Боб '] })

    expect(errors).toEqual([])
    expect(dto.title).toBe('Планёрка')
    expect(dto.participants).toEqual(['Алиса', 'Боб'])
  })

  it.each([
    ['', 'Название не может быть пустым'],
    ['   ', 'Название не может быть пустым'],
    [123, 'Название должно быть строкой'],
    ['а'.repeat(201), 'Название должно быть не длиннее 200 символов'],
    ['План\u0000ёрка', 'Название содержит недопустимые символы'],
    ['abc‮gnp', 'Название содержит недопустимые символы'],
    ['​⁠﻿', 'Название не может быть пустым'],
    ['\u0301\u0301', 'Название не может быть пустым'],
    ['\u3164', 'Название не может быть пустым'],
    ['\u2800', 'Название не может быть пустым'],
  ])('название %j отклоняется: %s', async (title, message) => {
    await expect(check({ title }).then((r) => r.errors)).resolves.toContain(message)
  })

  it.each([
    ['', 'Имя участника не может быть пустым'],
    [' ', 'Имя участника не может быть пустым'],
    [1, 'Имя участника должно быть строкой'],
    ['б'.repeat(101), 'Имя участника должно быть не длиннее 100 символов'],
    ['Б\u001bоб', 'Имя участника содержит недопустимые символы'],
    ['​', 'Имя участника не может быть пустым'],
  ])('имя участника %j отклоняется: %s', async (name, message) => {
    await expect(check({ participants: ['Алиса', name] }).then((r) => r.errors)).resolves.toContain(
      message,
    )
  })

  it('ограничивает число участников 50', async () => {
    const names = (n: number) => Array.from({ length: n }, (_, i) => `Участник ${i}`)

    await expect(check({ participants: names(50) }).then((r) => r.errors)).resolves.toEqual([])
    await expect(check({ participants: names(51) }).then((r) => r.errors)).resolves.toContain(
      'Участников должно быть не больше 50',
    )
    await expect(check({ participants: 'Алиса' }).then((r) => r.errors)).resolves.toContain(
      'Участники должны быть списком',
    )
  })

  it.each([
    ['без названия', { title: undefined }, 'title', 'Название должно быть строкой'],
    ['название-число', { title: 123 }, 'title', 'Название должно быть строкой'],
    [
      'без участников',
      { participants: undefined },
      'participants',
      'Участники должны быть списком',
    ],
    ['участники null', { participants: null }, 'participants', 'Участники должны быть списком'],
    ['участники-объект', { participants: {} }, 'participants', 'Участники должны быть списком'],
    [
      'без даты',
      { date: undefined },
      'date',
      'Дата должна быть в формате ISO 8601 с часовым поясом, например 2030-01-15T10:00:00Z',
    ],
  ])('%s — ровно одна понятная причина', async (_title, overrides, property, message) => {
    const dto = plainToInstance(CreateMeetingDto, { ...valid, ...overrides })
    const errors = await validate(dto)

    expect(errors.map((e) => [e.property, Object.values(e.constraints ?? {})])).toEqual([
      [property, [message]],
    ])
  })

  it('длина считается в кодовых точках, как maxLength в JSON Schema', async () => {
    await expect(
      check({ participants: ['👍'.repeat(100)] }).then((r) => r.errors),
    ).resolves.toEqual([])
    await expect(
      check({ participants: ['👍'.repeat(101)] }).then((r) => r.errors),
    ).resolves.toEqual(['Имя участника должно быть не длиннее 100 символов'])
    // селектор варианта — отдельная кодовая точка: 'a\uFE0F' × 50 = 100, × 51 = 102
    await expect(
      check({ participants: ['a\uFE0F'.repeat(50)] }).then((r) => r.errors),
    ).resolves.toEqual([])
    await expect(
      check({ participants: ['a\uFE0F'.repeat(51)] }).then((r) => r.errors),
    ).resolves.toEqual(['Имя участника должно быть не длиннее 100 символов'])
  })

  it.each(['2030-01-15T10:00:00Z', '2030-01-15T15:00:00+03:00', '2030-01-15T10:00-05:30'])(
    'принимает дату %s, и new Date её понимает',
    async (date) => {
      await expect(check({ date }).then((r) => r.errors)).resolves.toEqual([])
      expect(Number.isNaN(new Date(date).getTime())).toBe(false)
    },
  )

  it.each([
    undefined,
    '',
    '2030-02-30T10:00:00Z',
    '2030-01-15T10:00:00',
    '2030-01-15',
    '15.01.2030',
    '20300115T10:00:00Z',
    '2030-W03-2T10:00:00Z',
    '2030-015T10:00:00Z',
    '2030-01-15T10:00:00,5Z',
    '2030-01-15T10:00:00+03',
    '2030-01-15T10:00:00.000-0530',
    '2030-01-15T10:00:00z',
    1894701600000,
  ])('отклоняет дату %j', async (date) => {
    const { errors } = await check({ date })

    expect(errors.length).toBeGreaterThan(0)
    expect(errors.every((m) => m.startsWith('Дата должна быть в формате ISO 8601'))).toBe(true)
  })
})
