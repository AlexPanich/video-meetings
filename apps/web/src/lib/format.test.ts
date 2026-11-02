import { fileStatusLabel, formatFileSize } from './format'

describe('formatFileSize', () => {
  it('показывает байты, килобайты, мегабайты и гигабайты по-русски', () => {
    expect(formatFileSize(0)).toBe('0 Б')
    expect(formatFileSize(1023)).toBe('1023 Б')
    expect(formatFileSize(1536)).toBe('1,5 КБ')
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5 МБ')
    expect(formatFileSize(500 * 1024 * 1024)).toBe('500 МБ')
    expect(formatFileSize(1.5 * 1024 * 1024 * 1024)).toBe('1,5 ГБ')
  })
})

describe('fileStatusLabel', () => {
  it('переводит статусы файла', () => {
    expect(fileStatusLabel('uploading')).toBe('Загружается')
    expect(fileStatusLabel('uploaded')).toBe('Загружен')
    expect(fileStatusLabel('failed')).toBe('Ошибка')
  })
})
