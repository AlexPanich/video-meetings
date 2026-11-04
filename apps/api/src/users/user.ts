import type { User } from '../generated/prisma/client.js'

export type PublicUser = Pick<User, 'id' | 'email' | 'name'> & {
  hasAvatar: boolean
  // версия аватара (мс от эпохи) для URL изображения: меняется при замене, сбрасывает кэш браузера
  avatarVersion: number | null
}

type UserLike = Pick<User, 'id' | 'email' | 'name'> &
  Partial<Pick<User, 'avatarStorageName' | 'avatarUpdatedAt'>>

export const toPublicUser = ({
  id,
  email,
  name,
  avatarStorageName,
  avatarUpdatedAt,
}: UserLike): PublicUser => {
  const hasAvatar = Boolean(avatarStorageName)
  return {
    id,
    email,
    name,
    hasAvatar,
    avatarVersion: hasAvatar && avatarUpdatedAt ? avatarUpdatedAt.getTime() : null,
  }
}
