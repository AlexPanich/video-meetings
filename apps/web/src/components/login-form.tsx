'use client'

import { Alert, Button, FieldError, Form, Input, Label, Spinner, TextField } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { type SyntheticEvent, useState } from 'react'
import { login } from '@/lib/api'
import { PasswordField } from './password-field'
import { setToken } from '@/lib/session'

export function LoginForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const onSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setError(null)
    setPending(true)
    try {
      const { accessToken } = await login(String(data.get('email')), String(data.get('password')))
      setToken(accessToken)
      // Next сохраняет состояние ушедшей страницы — очищаем, чтобы форма не вернулась заполненной
      form.reset()
      setPending(false)
      router.push('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Что-то пошло не так')
      setPending(false)
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
        isRequired
        aria-label="Email"
        variant="secondary"
        name="email"
        type="email"
        autoComplete="email"
      >
        <Label>Email</Label>
        <Input placeholder="you@example.com" />
        <FieldError>Введите корректный email</FieldError>
      </TextField>

      <PasswordField
        name="password"
        autoComplete="current-password"
        label="Пароль"
        placeholder="Ваш пароль"
        errorText="Введите пароль"
      />

      <Button type="submit" className="mt-3 w-full" isPending={pending}>
        {pending ? <Spinner aria-label="Загрузка" color="current" size="sm" /> : null}
        Войти
      </Button>
    </Form>
  )
}
