'use client'

import { File } from '@gravity-ui/icons'
import { Alert, Button, Card, Chip, Skeleton } from '@heroui/react'
import { useEffect, useState } from 'react'
import { type FileStatus, getMeetingFiles, type MeetingFile } from '@/lib/api'
import { fileStatusLabel, formatFileSize } from '@/lib/format'

const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })

const STATUS_COLOR: Record<FileStatus, 'success' | 'warning' | 'danger'> = {
  uploaded: 'success',
  uploading: 'warning',
  failed: 'danger',
}

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; files: MeetingFile[] }

export function MeetingFiles({ meetingId }: { meetingId: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' })

  // каждая попытка (первая и «Повторить») — отдельный запуск эффекта; ответ устаревшей попытки
  // (смена встречи, размонтирование) игнорируется
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let ignore = false
    getMeetingFiles(meetingId).then(
      (files) => !ignore && setState({ kind: 'ready', files }),
      () => !ignore && setState({ kind: 'error' }),
    )
    return () => {
      ignore = true
    }
  }, [meetingId, attempt])

  const retry = () => {
    setState({ kind: 'loading' })
    setAttempt((n) => n + 1)
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title>Файлы</Card.Title>
      </Card.Header>
      <Card.Content>
        {state.kind === 'loading' && (
          <div role="status" aria-label="Загрузка файлов" className="flex flex-col gap-3">
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
        )}

        {state.kind === 'error' && (
          <Alert status="danger" role="alert">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Не удалось загрузить файлы</Alert.Title>
              <Button className="mt-2" size="sm" onPress={retry}>
                Повторить
              </Button>
            </Alert.Content>
          </Alert>
        )}

        {state.kind === 'ready' &&
          (state.files.length === 0 ? (
            <p className="text-muted">Файлов пока нет</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {state.files.map((file) => (
                <li key={file.id} className="flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                    <File className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{file.name}</p>
                    <p className="text-sm text-muted">
                      <span>{formatFileSize(file.size)}</span>
                      {' · '}
                      <span>{dateFormat.format(new Date(file.createdAt))}</span>
                    </p>
                  </div>
                  <Chip color={STATUS_COLOR[file.status]} size="sm">
                    {fileStatusLabel(file.status)}
                  </Chip>
                </li>
              ))}
            </ul>
          ))}
      </Card.Content>
    </Card>
  )
}
