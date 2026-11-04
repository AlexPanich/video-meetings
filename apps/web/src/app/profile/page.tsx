import { ArrowLeft } from '@gravity-ui/icons'
import { Skeleton } from '@heroui/react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { ProfileCard } from '@/components/profile-card'
import { getCurrentUser } from '@/lib/server/auth'

export const metadata: Metadata = { title: 'Профиль — Video Meetings' }

async function Profile() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  return <ProfileCard user={user} />
}

export default function ProfilePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 px-4 py-12">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted hover:underline">
        <ArrowLeft className="size-4" />
        На главную
      </Link>
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-2xl" />}>
        <Profile />
      </Suspense>
    </main>
  )
}
