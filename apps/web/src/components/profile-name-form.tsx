'use client'

import { Alert, Button, FieldError, Form, Input, Label, Spinner, TextField } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { type SyntheticEvent, useState } from 'react'
import { ApiError, updateProfileName } from '@/lib/api'
import { validateName } from '@/lib/profile-name'

export function ProfileNameForm({ initialName }: { initialName: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const onSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name')).trim()
    setError(null)
    setPending(true)
    try {
      await updateProfileName(name)
      setPending(false)
      router.push('/profile')
      // Next 16 хранит уже открытые страницы: без обновления профиль и главная покажут прежнее имя
      router.refresh()
    } catch (e) {
      setPending(false)
      if (e instanceof ApiError && e.status === 401) {
        router.replace('/login')
        return
      }
      setError(e instanceof Error ? e.message : 'Что-то пошло не так')
    }
  }

  return (
    <Form className="flex flex-col gap-5" onSubmit={onSubmit}>
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
        <FieldError />
      </TextField>

      <Button type="submit" className="w-full" isPending={pending}>
        {pending ? <Spinner aria-label="Загрузка" color="current" size="sm" /> : null}
        Сохранить
      </Button>
    </Form>
  )
}
