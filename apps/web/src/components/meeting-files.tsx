'use client'

import { File } from '@gravity-ui/icons'
import { Alert, Button, Card, Chip, Skeleton } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { ApiError, type FileStatus, getMeetingFiles, type MeetingFile } from '@/lib/api'
import { fileStatusLabel, formatFileSize } from '@/lib/format'
import { FileUploader } from './file-uploader'
import { LocalDateTime } from './local-date-time'

const STATUS_COLOR: Record<FileStatus, 'success' | 'warning' | 'danger'> = {
  uploaded: 'success',
  uploading: 'warning',
  failed: 'danger',
}

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; files: MeetingFile[] }

export function MeetingFiles({ meetingId }: { meetingId: string }) {
  const router = useRouter()
  // результат привязан к встрече: после смены meetingId список прежней не показывается
  const [loaded, setLoaded] = useState<{ meetingId: string; state: State }>({
    meetingId,
    state: { kind: 'loading' },
  })
  const state: State = loaded.meetingId === meetingId ? loaded.state : { kind: 'loading' }

  // каждая попытка (первая и «Повторить») — отдельный запуск эффекта; ответ устаревшей попытки
  // (смена встречи, размонтирование) игнорируется
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let ignore = false
    getMeetingFiles(meetingId).then(
      (files) => !ignore && setLoaded({ meetingId, state: { kind: 'ready', files } }),
      (error: unknown) => {
        if (ignore) return
        // токен отклонён (прокси уже сбросил cookie): повтор не поможет, нужен вход
        if (error instanceof ApiError && error.status === 401) {
          router.replace('/login')
          return
        }
        setLoaded({ meetingId, state: { kind: 'error' } })
      },
    )
    return () => {
      ignore = true
    }
  }, [meetingId, attempt, router])

  const retry = () => {
    setLoaded({ meetingId, state: { kind: 'loading' } })
    setAttempt((n) => n + 1)
  }

  // после загрузки список перечитывается без показа скелетона
  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  const goToLogin = useCallback(() => router.replace('/login'), [router])

  return (
    <Card>
      <Card.Header>
        <Card.Title>Файлы</Card.Title>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <FileUploader
          key={meetingId}
          meetingId={meetingId}
          onUploaded={reload}
          onUnauthorized={goToLogin}
        />

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
                      <LocalDateTime value={file.createdAt} />
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
