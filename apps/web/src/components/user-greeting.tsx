import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/server/auth'
import { LogoutButton } from './logout-button'

export async function UserGreeting() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-lg">
        Привет, <span className="font-semibold">{user.name}</span>!
      </p>
      <LogoutButton />
    </div>
  )
}
