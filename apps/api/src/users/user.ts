import type { User } from '../generated/prisma/client.js'

export type PublicUser = Pick<User, 'id' | 'email' | 'name'>

export const toPublicUser = ({ id, email, name }: User | PublicUser): PublicUser => ({
  id,
  email,
  name,
})
