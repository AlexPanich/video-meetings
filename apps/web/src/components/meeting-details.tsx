import { ArrowLeft, Calendar } from '@gravity-ui/icons'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { MeetingFiles } from '@/components/meeting-files'
import { getCurrentUser } from '@/lib/server/auth'
import { getMeeting } from '@/lib/server/meetings'

const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' })

export async function MeetingDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const meeting = await getMeeting(id)
  if (!meeting) {
    // токен отклонён — на вход; иначе встречи нет или она чужая
    if (!(await getCurrentUser())) redirect('/login')
    notFound()
  }

  return (
    <div className="flex w-full flex-col gap-4 text-left">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted hover:underline">
        <ArrowLeft className="size-4" />
        Все встречи
      </Link>
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{meeting.title}</h1>
        <p className="mt-1 flex items-center gap-2 text-muted">
          <Calendar className="size-4" />
          {dateFormat.format(new Date(meeting.date))} · {meeting.participants.length} участн.
        </p>
      </div>
      <MeetingFiles meetingId={meeting.id} />
    </div>
  )
}
