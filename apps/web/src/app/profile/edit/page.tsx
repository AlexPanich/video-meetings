import { ArrowLeft } from '@gravity-ui/icons'
import { Skeleton } from '@heroui/react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { ProfileNameForm } from '@/components/profile-name-form'
import { AvatarEditor } from '@/components/avatar-editor'
import { getCurrentUser } from '@/lib/server/auth'

export const metadata: Metadata = { title: 'Редактирование профиля — Video Meetings' }

async function EditProfile() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-border p-8">
      <div className="flex flex-col gap-2">
        <AvatarEditor
          name={user.name}
          hasAvatar={Boolean(user.hasAvatar)}
          avatarVersion={user.avatarVersion ?? null}
        />
        <p className="text-muted">{user.email}</p>
      </div>
      {/* key: после сохранения или смены пользователя форма создаётся заново, а не хранит старый ввод */}
      <ProfileNameForm key={`${user.id}:${user.name}`} initialName={user.name} />
    </div>
  )
}

export default function EditProfilePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 px-4 py-12">
      <Link
        href="/profile"
        className="inline-flex items-center gap-1 text-sm text-muted hover:underline"
      >
        <ArrowLeft className="size-4" />К профилю
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Редактирование профиля</h1>
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-2xl" />}>
        <EditProfile />
      </Suspense>
    </main>
  )
}
