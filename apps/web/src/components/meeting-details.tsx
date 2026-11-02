import { ArrowLeft, Calendar } from '@gravity-ui/icons'
import { Alert } from '@heroui/react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { LocalDateTime } from '@/components/local-date-time'
import { MeetingFiles } from '@/components/meeting-files'
import { formatParticipants } from '@/lib/format'
import { getMeeting } from '@/lib/server/meetings'

export async function MeetingDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await getMeeting(id)
  // токен отсутствует или отклонён — на вход; встречи нет или она чужая — 404
  if (!result.ok && result.status === 401) redirect('/login')
  if (!result.ok && result.status === 404) notFound()

  return (
    <div className="flex w-full flex-col gap-4 text-left">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted hover:underline">
        <ArrowLeft className="size-4" />
        Все встречи
      </Link>
      {result.ok ? (
        <>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{result.data.title}</h1>
            <p className="mt-1 flex items-center gap-2 text-muted">
              <Calendar className="size-4" />
              <LocalDateTime value={result.data.date} style="long" />
              {' · '}
              {formatParticipants(result.data.participants.length)}
            </p>
          </div>
          <MeetingFiles key={result.data.id} meetingId={result.data.id} />
        </>
      ) : (
        // временный сбой (5xx, сеть): это не «встреча не найдена»
        <Alert status="danger" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Не удалось загрузить встречу</Alert.Title>
            <Alert.Description>Попробуйте обновить страницу через минуту.</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
    </div>
  )
}
