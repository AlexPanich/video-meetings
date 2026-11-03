'use client'

import { ArrowUpFromLine, File } from '@gravity-ui/icons'
import { Alert, Button, buttonVariants, Chip, ProgressBar } from '@heroui/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '@/lib/api'
import { fileStatusLabel, formatFileSize } from '@/lib/format'
import { MAX_UPLOAD_BYTES, uploadFile } from '@/lib/upload'

interface Item {
  id: number
  file: File
  status: 'uploading' | 'failed'
  progress: number
  error?: string
}

interface FileUploaderProps {
  meetingId: string
  // файл дошёл до сервера (можно обновить список)
  onUploaded?: () => void
  // сервер отклонил токен — нужен повторный вход
  onUnauthorized?: () => void
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

export function FileUploader({ meetingId, onUploaded, onUnauthorized }: FileUploaderProps) {
  const [items, setItems] = useState<Item[]>([])
  const [rejected, setRejected] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const nextId = useRef(0)
  const controllers = useRef(new Set<AbortController>())

  // уходим со страницы — незавершённые загрузки прерываются
  useEffect(() => {
    const active = controllers.current
    return () => {
      active.forEach((controller) => controller.abort())
      active.clear()
    }
  }, [])

  const patch = useCallback((id: number, changes: Partial<Item>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)))
  }, [])

  const start = useCallback(
    (id: number, file: File) => {
      const controller = new AbortController()
      controllers.current.add(controller)
      uploadFile(meetingId, file, {
        signal: controller.signal,
        onProgress: (loaded, total) => patch(id, { progress: Math.round((loaded / total) * 100) }),
      }).then(
        () => {
          controllers.current.delete(controller)
          setItems((current) => current.filter((item) => item.id !== id))
          onUploaded?.()
        },
        (error: unknown) => {
          controllers.current.delete(controller)
          if (isAbort(error)) return
          if (error instanceof ApiError && error.status === 401) onUnauthorized?.()
          patch(id, {
            status: 'failed',
            error: error instanceof ApiError ? error.message : 'Что-то пошло не так',
          })
        },
      )
    },
    [meetingId, onUploaded, onUnauthorized, patch],
  )

  const addFiles = (list: FileList | File[]) => {
    const files = Array.from(list)
    const tooBig = files.filter((file) => file.size > MAX_UPLOAD_BYTES)
    setRejected(
      tooBig.map(
        (file) =>
          `Файл «${file.name}» (${formatFileSize(file.size)}) больше ${formatFileSize(MAX_UPLOAD_BYTES)} — он не будет загружен`,
      ),
    )
    const accepted = files
      .filter((file) => file.size <= MAX_UPLOAD_BYTES)
      .map((file) => ({ id: nextId.current++, file }))
    if (accepted.length === 0) return
    setItems((current) => [
      ...current,
      ...accepted.map(({ id, file }): Item => ({ id, file, status: 'uploading', progress: 0 })),
    ])
    accepted.forEach(({ id, file }) => start(id, file))
  }

  const retry = (item: Item) => {
    patch(item.id, { status: 'uploading', progress: 0, error: undefined })
    start(item.id, item.file)
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        data-testid="drop-zone"
        onDragEnter={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          addFiles(event.dataTransfer.files)
        }}
        className={`flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
          dragging ? 'border-accent bg-accent/10' : 'border-border'
        }`}
      >
        <ArrowUpFromLine className="size-6 text-muted" />
        <p className="text-muted">Перетащите файлы сюда или выберите на устройстве</p>
        <p className="text-sm text-muted">До {formatFileSize(MAX_UPLOAD_BYTES)} на файл</p>
        {/* не <Button>: react-aria читает Date.now() при рендере, а Next 16 (cacheComponents)
            запрещает это в предрендере; здесь нужен только вид кнопки */}
        <button
          type="button"
          className={buttonVariants({ size: 'sm' })}
          onClick={() => inputRef.current?.click()}
        >
          Выбрать файлы
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          aria-label="Выбрать файлы"
          aria-hidden="true"
          tabIndex={-1}
          className="sr-only"
          onChange={(event) => {
            addFiles(event.target.files ?? [])
            // тот же файл можно выбрать повторно
            event.target.value = ''
          }}
        />
      </div>

      {rejected.length > 0 && (
        <Alert status="danger" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Не удалось добавить файлы</Alert.Title>
            <ul>
              {rejected.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </Alert.Content>
        </Alert>
      )}

      {items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                <File className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.file.name}</p>
                {item.status === 'uploading' ? (
                  <ProgressBar
                    aria-label={`Загрузка ${item.file.name}`}
                    size="sm"
                    value={item.progress}
                  >
                    <ProgressBar.Output />
                    <ProgressBar.Track>
                      <ProgressBar.Fill />
                    </ProgressBar.Track>
                  </ProgressBar>
                ) : (
                  <p className="text-sm text-danger">{item.error}</p>
                )}
              </div>
              <Chip color={item.status === 'failed' ? 'danger' : 'warning'} size="sm">
                {fileStatusLabel(item.status === 'failed' ? 'failed' : 'uploading')}
              </Chip>
              {item.status === 'failed' && (
                <Button size="sm" variant="secondary" onPress={() => retry(item)}>
                  Повторить
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
