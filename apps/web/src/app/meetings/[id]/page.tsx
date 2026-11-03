import { Skeleton } from '@heroui/react'
import { Suspense } from 'react'
import { MeetingDetails } from '@/components/meeting-details'

export default function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 px-4 py-12">
      {/* params и данные встречи зависят от запроса — читаются внутри Suspense */}
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-2xl" />}>
        <MeetingDetails params={params} />
      </Suspense>
    </main>
  )
}
