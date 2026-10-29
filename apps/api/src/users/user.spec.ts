import { toPublicUser } from './user.js'

describe('toPublicUser', () => {
  it('оставляет только id, email и name', () => {
    const user = { id: 'u1', email: 'alice@example.com', name: 'Alice', passwordHash: 'hash' }

    expect(toPublicUser(user as never)).toEqual({
      id: 'u1',
      email: 'alice@example.com',
      name: 'Alice',
    })
  })
})
