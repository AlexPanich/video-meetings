'use client'

import { AlertDialog, Alert, Button } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { type ChangeEvent, useRef, useState } from 'react'
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
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = '' // тот же файл можно выбрать повторно
    if (!file || uploading) return
    const reason = validateAvatarFile(file)
    setError(reason)
    if (reason) return

    setUploading(true)
    try {
      await uploadAvatar(file)
      // Next 16 хранит открытые страницы: без обновления профиль и главная покажут прежний аватар
      router.refresh()
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace('/login')
        return
      }
      setError(messageOf(e))
    } finally {
      setUploading(false)
    }
  }

  const confirmDelete = async () => {
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteAvatar()
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
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
    router.refresh()
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
            variant="secondary"
            isPending={uploading}
            onPress={() => inputRef.current?.click()}
          >
            {hasAvatar ? 'Заменить' : 'Загрузить фото'}
          </Button>
          {hasAvatar && (
            <Button
              variant="tertiary"
              aria-label="Удалить аватар"
              isDisabled={uploading}
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
        <Alert status="danger">
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
