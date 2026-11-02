import { attachmentDisposition } from './content-disposition.js'

describe('attachmentDisposition', () => {
  it('кодирует кириллицу в filename* и даёт ASCII-запасной вариант', () => {
    expect(attachmentDisposition('Протокол №1.txt')).toBe(
      `attachment; filename="________ _1.txt"; filename*=UTF-8''${encodeURIComponent('Протокол №1.txt')}`,
    )
  })

  it('экранирует кавычки, обратный слеш и символы, недопустимые в filename*', () => {
    const header = attachmentDisposition(`a"b\\c(1)'*.txt`)
    expect(header).toContain(`filename*=UTF-8''a%22b%5Cc%281%29%27%2A.txt`)
    expect(header).toContain('filename="a_b_c(1)\'*.txt"')
  })

  it('обычное ASCII-имя остаётся как есть', () => {
    expect(attachmentDisposition('notes.txt')).toBe(
      `attachment; filename="notes.txt"; filename*=UTF-8''notes.txt`,
    )
  })
})
