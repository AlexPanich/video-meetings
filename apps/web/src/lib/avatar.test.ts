import { MAX_AVATAR_BYTES, hasAvatarSignature, validateAvatarFile } from './avatar'

const bytes = (...values: number[]) => new Uint8Array(new ArrayBuffer(values.length)).map((_, i) => values[i])
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0))

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1)
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d)
const WEBP = bytes(...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WEBP'))
const PDF = bytes(...ascii('%PDF-1.7 abc'))

const file = (content: Uint8Array<ArrayBuffer>, type: string, size?: number) => {
  const f = new File([content], 'avatar', { type })
  if (size !== undefined) Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('hasAvatarSignature', () => {
  it.each([
    ['JPEG', JPEG],
    ['PNG', PNG],
    ['WebP', WEBP],
  ])('узнаёт %s', (_, head) => {
    expect(hasAvatarSignature(head)).toBe(true)
  })

  it.each([
    ['PDF', PDF],
    ['RIFF без WEBP (WAV)', bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE'))],
    ['короткий файл', bytes(0xff, 0xd8)],
    ['пустой файл', bytes()],
  ])('не принимает %s', (_, head) => {
    expect(hasAvatarSignature(head)).toBe(false)
  })
})

describe('validateAvatarFile', () => {
  it('стандартный тип пропускает без чтения файла: формат проверит API', async () => {
    expect(await validateAvatarFile(file(PDF, 'image/png'))).toBeNull()
  })

  it.each([
    ['пустой', ''],
    ['image/jpg', 'image/jpg'],
    ['image/pjpeg', 'image/pjpeg'],
  ])('тип «%s» с сигнатурой картинки пропускает', async (_, type) => {
    expect(await validateAvatarFile(file(JPEG, type))).toBeNull()
  })

  it.each([
    ['пустой', ''],
    ['image/jpg', 'image/jpg'],
  ])('тип «%s» с чужой сигнатурой отклоняет', async (_, type) => {
    expect(await validateAvatarFile(file(PDF, type))).toBe('Допустимы только JPEG, PNG и WebP')
  })

  it('явно другой тип отклоняет, даже если внутри картинка', async () => {
    expect(await validateAvatarFile(file(JPEG, 'application/pdf'))).toBe(
      'Допустимы только JPEG, PNG и WebP',
    )
  })

  it('файл больше 5 МБ отклоняет, в том числе с пустым типом', async () => {
    expect(await validateAvatarFile(file(PNG, 'image/png', MAX_AVATAR_BYTES + 1))).toBe(
      'Файл больше 5 МБ',
    )
    expect(await validateAvatarFile(file(JPEG, '', MAX_AVATAR_BYTES + 1))).toBe('Файл больше 5 МБ')
  })

  it('не прочитанный файл с пустым типом отдаёт на проверку API', async () => {
    const f = file(JPEG, '')
    vi.spyOn(f, 'slice').mockImplementation(() => {
      throw new Error('NotReadableError')
    })
    expect(await validateAvatarFile(f)).toBeNull()
  })
})
