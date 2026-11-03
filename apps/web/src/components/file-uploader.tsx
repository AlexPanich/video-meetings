'use client'

import { ArrowUpFromLine } from '@gravity-ui/icons'
import { Alert, Button, buttonVariants, ProgressBar } from '@heroui/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '@/lib/api'
import { fileStatusColor, fileStatusLabel, formatFileSize } from '@/lib/format'
import { MAX_UPLOAD_BYTES, uploadFile } from '@/lib/upload'
import { FileRow } from './file-row'

// одновременно идут не больше стольких загрузок, остальные ждут в очереди
const MAX_CONCURRENT = 3

interface Item {
  id: number
  file: File
  status: 'queued' | 'uploading' | 'done' | 'failed'
  progress: number
  error?: string
}

interface FileUploaderProps {
  meetingId: string
  // все загрузки очереди завершились и хотя бы одна успешна: список можно перечитать.
  // Пока промис не завершён, загруженные файлы остаются в очереди со статусом «Загружен»
  onUploaded?: () => void | Promise<void>
  // сервер отклонил токен — нужен повторный вход
  onUnauthorized?: () => void
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')

export function FileUploader({ meetingId, onUploaded, onUnauthorized }: FileUploaderProps) {
  const [items, setItems] = useState<Item[]>([])
  const [rejected, setRejected] = useState<{ id: number; message: string }[]>([])
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const nextId = useRef(0)
  const [controllers] = useState(() => new Map<number, AbortController>())
  const queue = useRef<{ id: number; file: File }[]>([])
  const running = useRef(0)
  const done = useRef<number[]>([])

  const patch = useCallback((id: number, changes: Partial<Item>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)))
  }, [])

  const pump = useCallback(
    function pump(): void {
      // загрузки завершились: перечитываем список разом и только потом убираем файлы из очереди
      const flush = () => {
        if (running.current > 0 || queue.current.length > 0 || done.current.length === 0) return
        const ids = done.current.splice(0)
        Promise.resolve(onUploaded?.()).finally(() =>
          setItems((current) => current.filter((item) => !ids.includes(item.id))),
        )
      }
      const settle = (id: number) => {
        controllers.delete(id)
        running.current--
        pump()
        flush()
      }

      while (running.current < MAX_CONCURRENT && queue.current.length > 0) {
        const { id, file } = queue.current.shift()!
        const controller = new AbortController()
        controllers.set(id, controller)
        running.current++
        patch(id, { status: 'uploading', progress: 0 })
        uploadFile(meetingId, file, {
          signal: controller.signal,
          onProgress: (loaded, total) => {
            const progress = Math.round((loaded / total) * 100)
            // событий прогресса много, процент меняется реже: лишних рендеров не делаем
            setItems((current) =>
              current.some((item) => item.id === id && item.progress !== progress)
                ? current.map((item) => (item.id === id ? { ...item, progress } : item))
                : current,
            )
          },
        }).then(
          () => {
            done.current.push(id)
            patch(id, { status: 'done', progress: 100 })
            settle(id)
          },
          (error: unknown) => {
            if (error instanceof ApiError && error.status === 401) onUnauthorized?.()
            patch(id, {
              status: 'failed',
              error: isAbort(error)
                ? 'Загрузка прервана'
                : error instanceof ApiError
                  ? error.message
                  : 'Что-то пошло не так',
            })
            settle(id)
          },
        )
      }
    },
    [meetingId, onUploaded, onUnauthorized, patch, controllers],
  )

  // Уход со страницы: загрузки прерываются, а ожидающие помечаются ошибкой, чтобы их можно было
  // повторить. Next 16 (cacheComponents) при уходе только скрывает страницу (Activity): состояние
  // остаётся, и без этого строки навсегда зависли бы в «Загружается»
  useEffect(() => {
    return () => {
      const waiting = queue.current.splice(0).map(({ id }) => id)
      if (waiting.length > 0) {
        setItems((current) =>
          current.map((item) =>
            waiting.includes(item.id)
              ? { ...item, status: 'failed', error: 'Загрузка прервана' }
              : item,
          ),
        )
      }
      controllers.forEach((controller) => controller.abort())
    }
  }, [controllers])

  // файл, брошенный мимо зоны, не должен открываться в этой вкладке и обрывать загрузки
  useEffect(() => {
    const block = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault()
    }
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
    }
  }, [])

  // закрытие вкладки во время загрузки — переспрашиваем
  const busy = items.some((item) => item.status === 'queued' || item.status === 'uploading')
  useEffect(() => {
    if (!busy) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  const enqueue = (entries: { id: number; file: File }[]) => {
    queue.current.push(...entries)
    pump()
  }

  const addFiles = (list: FileList | File[]) => {
    const files = Array.from(list)
    const tooBig = files.filter((file) => file.size > MAX_UPLOAD_BYTES)
    if (tooBig.length > 0) {
      setRejected((current) => [
        ...current,
        ...tooBig.map((file) => ({
          id: nextId.current++,
          message: `Файл «${file.name}» (${formatFileSize(file.size)}) больше ${formatFileSize(MAX_UPLOAD_BYTES)} — он не будет загружен`,
        })),
      ])
    }
    const accepted = files
      .filter((file) => file.size <= MAX_UPLOAD_BYTES)
      .map((file) => ({ id: nextId.current++, file }))
    if (accepted.length === 0) return
    setItems((current) => [
      ...current,
      ...accepted.map(({ id, file }): Item => ({ id, file, status: 'queued', progress: 0 })),
    ])
    enqueue(accepted)
  }

  const retry = (item: Item) => {
    patch(item.id, { status: 'queued', progress: 0, error: undefined })
    enqueue([{ id: item.id, file: item.file }])
  }

  // отмена идущей или ожидающей загрузки, а также «Убрать» упавшей
  const remove = (item: Item) => {
    queue.current = queue.current.filter(({ id }) => id !== item.id)
    setItems((current) => current.filter(({ id }) => id !== item.id))
    controllers.get(item.id)?.abort()
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
        onDragLeave={(event) => {
          // переход на дочерний элемент зоны — курсор всё ещё внутри
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
        }}
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
              {rejected.map(({ id, message }) => (
                <li key={id}>{message}</li>
              ))}
            </ul>
            <Button className="mt-2" size="sm" variant="secondary" onPress={() => setRejected([])}>
              Закрыть
            </Button>
          </Alert.Content>
        </Alert>
      )}

      {items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <FileRow
              key={item.id}
              name={item.file.name}
              status={
                item.status === 'queued'
                  ? 'В очереди'
                  : fileStatusLabel(
                      item.status === 'done'
                        ? 'uploaded'
                        : item.status === 'failed'
                          ? 'failed'
                          : 'uploading',
                    )
              }
              color={
                item.status === 'queued'
                  ? 'default'
                  : fileStatusColor[
                      item.status === 'done'
                        ? 'uploaded'
                        : item.status === 'failed'
                          ? 'failed'
                          : 'uploading'
                    ]
              }
              actions={
                <>
                  {item.status === 'failed' && (
                    <Button size="sm" variant="secondary" onPress={() => retry(item)}>
                      Повторить
                    </Button>
                  )}
                  {item.status !== 'done' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`${item.status === 'failed' ? 'Убрать' : 'Отменить'} ${item.file.name}`}
                      onPress={() => remove(item)}
                    >
                      {item.status === 'failed' ? 'Убрать' : 'Отменить'}
                    </Button>
                  )}
                </>
              }
            >
              {item.status === 'uploading' && (
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
              )}
              {item.status === 'failed' && <p className="text-sm text-danger">{item.error}</p>}
            </FileRow>
          ))}
        </ul>
      )}
    </div>
  )
}
