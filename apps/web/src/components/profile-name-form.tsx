'use client'

import { Alert, Button, FieldError, Form, Input, Label, Spinner, TextField } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { type SyntheticEvent, useEffect, useRef, useState, useTransition } from 'react'
import { ApiError, updateProfileName } from '@/lib/api'
import { validateName } from '@/lib/profile-name'

export function ProfileNameForm({ initialName }: { initialName: string }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [error, setError] = useState<string | null>(null)
  // pending держится до конца перехода на /profile, поэтому повторно отправить форму нельзя
  const [pending, startTransition] = useTransition()

  // Next 16 скрывает ушедшую страницу, а не размонтирует: при скрытии отрабатывает cleanup,
  // и при возвращении (или входе другого пользователя в той же вкладке) нет чужого черновика и ошибки
  useEffect(() => {
    const form = formRef.current
    return () => {
      form?.reset()
      setError(null)
    }
  }, [])

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    const name = String(new FormData(event.currentTarget).get('name')).trim()
    setError(null)
    startTransition(async () => {
      try {
        await updateProfileName(name)
        router.push('/profile')
        // Next 16 хранит уже открытые страницы: без обновления профиль и главная покажут прежнее имя
        router.refresh()
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          router.replace('/login')
          return
        }
        setError(e instanceof Error ? e.message : 'Что-то пошло не так')
      }
    })
  }

  return (
    <Form ref={formRef} className="flex flex-col gap-5" onSubmit={onSubmit}>
      {error && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      <TextField
        fullWidth
        aria-label="Имя"
        variant="secondary"
        name="name"
        autoComplete="name"
        defaultValue={initialName}
        validate={validateName}
      >
        <Label>Имя</Label>
        <Input placeholder="Как вас зовут" />
        {/* место под ошибку занято всегда: иначе при потере фокуса ошибка исчезает, кнопка уезжает
            вверх из-под курсора и клик по ней не засчитывается */}
        <div className="min-h-5">
          <FieldError />
        </div>
      </TextField>

      <Button type="submit" className="w-full" isPending={pending}>
        {pending ? <Spinner aria-label="Загрузка" color="current" size="sm" /> : null}
        Сохранить
      </Button>
    </Form>
  )
}
