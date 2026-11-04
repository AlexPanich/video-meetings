import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/server/auth'
import { LogoutButton } from './logout-button'
import { UserAvatar } from './user-avatar'

export async function UserGreeting() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  return (
    <div className="flex flex-col items-center gap-4">
      <Link
        href="/profile"
        aria-label="Профиль"
        className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <UserAvatar
          name={user.name}
          hasAvatar={user.hasAvatar}
          avatarVersion={user.avatarVersion}
          className="size-16 text-xl"
        />
      </Link>
      <p className="text-lg">
        Привет, <span className="font-semibold">{user.name}</span>!
      </p>
      <LogoutButton />
    </div>
  )
}
