import { toPublicUser } from './user.js'

describe('toPublicUser', () => {
  const base = { id: 'u1', email: 'alice@example.com', name: 'Alice', passwordHash: 'hash' }

  it('без аватара оставляет только публичные поля', () => {
    expect(toPublicUser(base as never)).toEqual({
      id: 'u1',
      email: 'alice@example.com',
      name: 'Alice',
      hasAvatar: false,
      avatarVersion: null,
    })
  })

  it('с аватаром отдаёт признак и версию, но не имя файла и MIME', () => {
    const user = {
      ...base,
      avatarStorageName: 'file-uuid',
      avatarMimeType: 'image/png',
      avatarUpdatedAt: new Date(1700000000000),
    }

    expect(toPublicUser(user as never)).toEqual({
      id: 'u1',
      email: 'alice@example.com',
      name: 'Alice',
      hasAvatar: true,
      avatarVersion: 1700000000000,
    })
  })
})
