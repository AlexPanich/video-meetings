import { sanitizeFileName, sanitizeMimeType } from './sanitize.js'

describe('sanitizeFileName', () => {
  it('оставляет обычное имя, в том числе с кириллицей', () => {
    expect(sanitizeFileName('Протокол №1.txt')).toBe('Протокол №1.txt')
  })

  it('подставляет file для пустого и отсутствующего имени', () => {
    expect(sanitizeFileName('')).toBe('file')
    expect(sanitizeFileName('   ')).toBe('file')
    expect(sanitizeFileName(undefined)).toBe('file')
  })

  it('убирает управляющие символы', () => {
    expect(sanitizeFileName('a\u0000b\nc\u007f.txt')).toBe('abc.txt')
  })

  it('режет имя до 255 символов, не ломая суррогатные пары', () => {
    const name = sanitizeFileName('😀'.repeat(300))
    expect(Array.from(name)).toHaveLength(255)
  })
})

describe('sanitizeMimeType', () => {
  it('принимает корректный type/subtype и приводит к нижнему регистру', () => {
    expect(sanitizeMimeType('Application/PDF')).toBe('application/pdf')
    expect(sanitizeMimeType('image/svg+xml')).toBe('image/svg+xml')
  })

  it('заменяет мусор и слишком длинные значения на octet-stream', () => {
    expect(sanitizeMimeType('text/html<script>')).toBe('application/octet-stream')
    expect(sanitizeMimeType('нет')).toBe('application/octet-stream')
    expect(sanitizeMimeType('a/' + 'b'.repeat(200))).toBe('application/octet-stream')
    expect(sanitizeMimeType(undefined)).toBe('application/octet-stream')
  })
})
