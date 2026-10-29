import { Calendar, Plus } from '@gravity-ui/icons'
import { Button, Card } from '@heroui/react'
import { getMeetings } from '@/lib/server/meetings'

const RECENT_COUNT = 3

const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })

const pluralize = (n: number) => {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'встреча'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'встречи'
  return 'встреч'
}

export async function MeetingsOverview() {
  const meetings = await getMeetings()
  const recent = meetings.toSorted((a, b) => b.date.localeCompare(a.date)).slice(0, RECENT_COUNT)

  return (
    <div className="flex w-full flex-col gap-4 text-left">
      <Card>
        <Card.Content className="flex-row items-center justify-between gap-4">
          <div>
            <p className="text-3xl font-semibold">{meetings.length}</p>
            <p className="text-muted">{pluralize(meetings.length)} всего</p>
          </div>
          {/* TODO: подключить создание встречи, когда появится форма */}
          <Button>
            <Plus />
            Создать встречу
          </Button>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>Последние встречи</Card.Title>
        </Card.Header>
        <Card.Content>
          {recent.length === 0 ? (
            <p className="text-muted">Пока нет встреч — создайте первую.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {recent.map((meeting) => (
                <li key={meeting.id} className="flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                    <Calendar className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{meeting.title}</p>
                    <p className="text-sm text-muted">
                      {dateFormat.format(new Date(meeting.date))} · {meeting.participants.length}{' '}
                      участн.
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card.Content>
      </Card>
    </div>
  )
}
