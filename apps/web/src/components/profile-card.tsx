import Link from 'next/link'
import { UserAvatar } from '@/components/user-avatar'
import type { User } from '@/lib/api'

export function ProfileCard({ user }: { user: User }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-border p-8 text-center">
      <UserAvatar name={user.name} className="size-20 text-2xl" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{user.name}</h1>
        <p className="mt-1 text-muted">{user.email}</p>
      </div>
      <Link href="/profile/edit" className="text-accent hover:underline">
        Редактировать
      </Link>
    </div>
  )
}
