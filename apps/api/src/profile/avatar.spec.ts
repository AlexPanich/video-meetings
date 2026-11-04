import { AVATAR_SIGNATURE_BYTES, detectAvatarMimeType } from './avatar.js'

describe('detectAvatarMimeType', () => {
  it('распознаёт JPEG', () => {
    expect(detectAvatarMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg')
  })

  it('распознаёт PNG', () => {
    const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    expect(detectAvatarMimeType(head)).toBe('image/png')
  })

  it('распознаёт WebP', () => {
    const head = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x40, 0, 0, 0]),
      Buffer.from('WEBP'),
    ])
    expect(detectAvatarMimeType(head)).toBe('image/webp')
  })

  it('не принимает RIFF без WEBP (например, WAV)', () => {
    const head = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x40, 0, 0, 0]),
      Buffer.from('WAVE'),
    ])
    expect(detectAvatarMimeType(head)).toBeNull()
  })

  it.each([
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['GIF', Buffer.from('GIF89a......')],
    ['текст', Buffer.from('это вовсе не картинка')],
    ['пусто', Buffer.alloc(0)],
    ['обрезанная сигнатура PNG', Buffer.from([0x89, 0x50, 0x4e])],
  ])('отклоняет %s', (_, head) => {
    expect(detectAvatarMimeType(head)).toBeNull()
  })

  it('для сигнатуры хватает AVATAR_SIGNATURE_BYTES байт', () => {
    expect(AVATAR_SIGNATURE_BYTES).toBe(12)
  })
})
