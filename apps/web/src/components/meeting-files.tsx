'use client'

import { ArrowDownToLine, TrashBin } from '@gravity-ui/icons'
import { AlertDialog, Alert, Button, buttonVariants, Card, Skeleton } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  deleteMeetingFile,
  fileDownloadUrl,
  getMeetingFiles,
  type MeetingFile,
} from '@/lib/api'
import { fileStatusColor, fileStatusLabel, formatFileSize } from '@/lib/format'
import { FileRow } from './file-row'
import { FileUploader } from './file-uploader'
import { LocalDateTime } from './local-date-time'

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; files: MeetingFile[] }

export function MeetingFiles({ meetingId }: { meetingId: string }) {
  const router = useRouter()
  // результат привязан к встрече: после смены meetingId список прежней не показывается
  const [loaded, setLoaded] = useState<{ meetingId: string; state: State }>({
    meetingId,
    state: { kind: 'loading' },
  })
  const state: State = loaded.meetingId === meetingId ? loaded.state : { kind: 'loading' }

  // Удалённые файлы: запоздавший ответ списка (запрошенный до удаления) не должен их вернуть
  const [deletedIds] = useState(() => new Set<string>())
  const showFiles = useCallback(
    (files: MeetingFile[]) =>
      setLoaded({
        meetingId,
        state: { kind: 'ready', files: files.filter((file) => !deletedIds.has(file.id)) },
      }),
    [meetingId, deletedIds],
  )

  // каждая попытка (первая и «Повторить») — отдельный запуск эффекта; ответ устаревшей попытки
  // (смена встречи, размонтирование) игнорируется
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let ignore = false
    getMeetingFiles(meetingId).then(
      (files) => !ignore && showFiles(files),
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
  }, [meetingId, attempt, router, showFiles])

  const retry = () => {
    setLoaded({ meetingId, state: { kind: 'loading' } })
    setAttempt((n) => n + 1)
  }

  // после загрузки список перечитывается без скелетона; при сбое остаётся прежний список
  const reload = useCallback(
    () => getMeetingFiles(meetingId).then(showFiles, () => undefined),
    [meetingId, showFiles],
  )

  // удаление: файл в диалоге (имя остаётся на время анимации закрытия), состояние запроса
  const [toDelete, setToDelete] = useState<MeetingFile | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const openDialog = (file: MeetingFile) => {
    setToDelete(file)
    setDeleteError(null)
    setDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (!toDelete) return
    setDeleting(true)
    setDeleteError(null)
    let gone = false
    try {
      await deleteMeetingFile(meetingId, toDelete.id)
      gone = true
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace('/login')
      } else if (error instanceof ApiError && error.status === 404) {
        gone = true // файл уже удалён (например, в другой вкладке) — цель достигнута
      } else {
        setDeleteError(error instanceof ApiError ? error.message : 'Что-то пошло не так')
      }
    } finally {
      setDeleting(false)
    }
    if (!gone) return

    const removedId = toDelete.id
    deletedIds.add(removedId)
    setLoaded((current) =>
      current.meetingId === meetingId && current.state.kind === 'ready'
        ? {
            meetingId,
            state: {
              kind: 'ready',
              files: current.state.files.filter((file) => file.id !== removedId),
            },
          }
        : current,
    )
    setDialogOpen(false)
    // строка-триггер исчезла, и фокус после закрытия диалога упал бы на <body>: после анимации
    // закрытия переносим его на список
    setTimeout(() => {
      if (!document.activeElement || document.activeElement === document.body) {
        listRef.current?.focus()
      }
    }, 300)
  }

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

        {state.kind === 'ready' && (
          <div ref={listRef} tabIndex={-1} className="outline-none">
            {state.files.length === 0 ? (
              <p className="text-muted">Файлов пока нет</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {state.files.map((file) => (
                  <FileRow
                    key={file.id}
                    name={file.name}
                    status={fileStatusLabel(file.status)}
                    color={fileStatusColor[file.status]}
                    actions={
                      <>
                        {file.status === 'uploaded' && (
                          // обычная ссылка: браузер сам стримит файл на диск и берёт имя из заголовка
                          <a
                            href={fileDownloadUrl(meetingId, file.id)}
                            download
                            aria-label={`Скачать ${file.name}`}
                            className={buttonVariants({
                              size: 'sm',
                              variant: 'ghost',
                              isIconOnly: true,
                            })}
                          >
                            <ArrowDownToLine className="size-4" />
                          </a>
                        )}
                        {file.status === 'uploaded' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            isIconOnly
                            aria-label={`Удалить ${file.name}`}
                            onPress={() => openDialog(file)}
                          >
                            <TrashBin className="size-4" />
                          </Button>
                        )}
                      </>
                    }
                  >
                    <p className="text-sm text-muted">
                      <span>{formatFileSize(file.size)}</span>
                      {' · '}
                      <LocalDateTime value={file.createdAt} />
                    </p>
                  </FileRow>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card.Content>

      <AlertDialog.Backdrop
        isOpen={dialogOpen}
        // во время запроса диалог не закрывается
        onOpenChange={(open) => !deleting && setDialogOpen(open)}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[420px]">
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Удалить файл?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>
                Файл <strong className="break-all">{toDelete?.name}</strong> будет удалён
                безвозвратно.
              </p>
              {deleteError && (
                <Alert className="mt-3" status="danger" role="alert">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>Не удалось удалить файл</Alert.Title>
                    <Alert.Description>{deleteError}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="tertiary" isDisabled={deleting} onPress={() => setDialogOpen(false)}>
                Отмена
              </Button>
              <Button variant="danger" isPending={deleting} onPress={confirmDelete}>
                Удалить
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </Card>
  )
}
