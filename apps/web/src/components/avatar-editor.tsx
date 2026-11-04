'use client'

import { AlertDialog, Alert, Button } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { type ChangeEvent, useEffect, useRef, useState, useTransition } from 'react'
import { ApiError, deleteAvatar, uploadAvatar } from '@/lib/api'
import { AVATAR_TYPES, validateAvatarFile } from '@/lib/avatar'
import { UserAvatar } from './user-avatar'

const messageOf = (e: unknown) => (e instanceof Error ? e.message : 'Что-то пошло не так')

export function AvatarEditor({
  name,
  hasAvatar,
  avatarVersion,
}: {
  name: string
  hasAvatar: boolean
  avatarVersion: number | null
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadButtonRef = useRef<HTMLButtonElement>(null)
  const busyRef = useRef(false) // защита от повторной отправки: state из замыкания может быть устаревшим
  const hadAvatarRef = useRef(hasAvatar)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // router.refresh() не ждёт ответа сервера: держим индикатор до конца перехода
  const [refreshing, startRefresh] = useTransition()

  // Next 16 скрывает страницу, а не размонтирует её: при уходе сбрасываем ошибку
  useEffect(() => () => setError(null), [])

  // После удаления кнопка «Удалить» исчезает, и фокус падает на <body>: возвращаем его на «Загрузить фото»
  useEffect(() => {
    const removed = hadAvatarRef.current && !hasAvatar
    hadAvatarRef.current = hasAvatar
    if (!removed) return
    const timer = setTimeout(() => {
      if (!document.activeElement || document.activeElement === document.body) {
        uploadButtonRef.current?.focus()
      }
    }, 300) // после анимации закрытия диалога, которая сама возвращает фокус
    return () => clearTimeout(timer)
  }, [hasAvatar])

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = '' // тот же файл можно выбрать повторно
    if (!file || busyRef.current) return
    const reason = validateAvatarFile(file)
    setError(reason)
    if (reason) return

    busyRef.current = true
    setUploading(true)
    try {
      await uploadAvatar(file)
      // Next 16 хранит открытые страницы: без обновления профиль и главная покажут прежний аватар
      startRefresh(() => router.refresh())
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace('/login')
        return
      }
      setError(messageOf(e))
    } finally {
      busyRef.current = false
      setUploading(false)
    }
  }

  const confirmDelete = async () => {
    setDeleting(true)
    setDeleteError(null)
    setError(null) // старая ошибка загрузки после удаления уже не актуальна
    try {
      await deleteAvatar()
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setDeleting(false)
        setDialogOpen(false)
        router.replace('/login')
        return
      }
      // 404: аватара уже нет — цель достигнута
      if (!(e instanceof ApiError && e.status === 404)) {
        setDeleteError(messageOf(e))
        setDeleting(false)
        return
      }
    }
    setDeleting(false)
    setDialogOpen(false)
    startRefresh(() => router.refresh())
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <UserAvatar
          name={name}
          hasAvatar={hasAvatar}
          avatarVersion={avatarVersion}
          className="size-20 text-2xl"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            ref={uploadButtonRef}
            variant="secondary"
            isPending={uploading || refreshing}
            onPress={() => inputRef.current?.click()}
          >
            {hasAvatar ? 'Заменить' : 'Загрузить фото'}
          </Button>
          {hasAvatar && (
            <Button
              variant="tertiary"
              aria-label="Удалить аватар"
              isDisabled={uploading || refreshing}
              onPress={() => {
                setDeleteError(null)
                setDialogOpen(true)
              }}
            >
              Удалить
            </Button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          hidden
          aria-label="Выбрать изображение"
          accept={AVATAR_TYPES.join(',')}
          onChange={onPick}
        />
      </div>
      <p className="text-sm text-muted">JPEG, PNG или WebP, до 5 МБ</p>
      {error && (
        <Alert status="danger" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      <AlertDialog.Backdrop
        isOpen={dialogOpen}
        // во время запроса диалог не закрывается
        onOpenChange={(open) => !deleting && setDialogOpen(open)}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[420px]">
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Удалить аватар?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>Вместо фото снова будут показываться инициалы.</p>
              {deleteError && (
                <Alert className="mt-3" status="danger" role="alert">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>Не удалось удалить аватар</Alert.Title>
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
    </div>
  )
}
