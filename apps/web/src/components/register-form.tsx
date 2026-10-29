'use client'

import { Alert, Button, FieldError, Form, Input, Label, Spinner, TextField } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { type SyntheticEvent, useState } from 'react'
import { register } from '@/lib/api'
import { PasswordField } from './password-field'

const MIN_PASSWORD_LENGTH = 8

export function RegisterForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [password, setPassword] = useState('')

  const onSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setError(null)
    setPending(true)
    try {
      await register(
        String(data.get('name')).trim(),
        String(data.get('email')),
        String(data.get('password')),
      )
      // Next сохраняет состояние ушедшей страницы — очищаем, чтобы форма не вернулась заполненной
      form.reset()
      setPassword('')
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

      <TextField isRequired aria-label="Имя" variant="secondary" name="name" autoComplete="name">
        <Label>Имя</Label>
        <Input placeholder="Как вас зовут" />
        <FieldError>Введите имя</FieldError>
      </TextField>

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
        autoComplete="new-password"
        label="Пароль"
        placeholder={`Не короче ${MIN_PASSWORD_LENGTH} символов`}
        value={password}
        onChange={setPassword}
        validate={(value) =>
          value.length < MIN_PASSWORD_LENGTH ? `Минимум ${MIN_PASSWORD_LENGTH} символов` : null
        }
      />

      <PasswordField
        name="confirmPassword"
        autoComplete="new-password"
        label="Подтвердите пароль"
        placeholder="Повторите пароль"
        validate={(value) => (value !== password ? 'Пароли не совпадают' : null)}
      />

      <Button type="submit" className="mt-3 w-full" isPending={pending}>
        {pending ? <Spinner aria-label="Загрузка" color="current" size="sm" /> : null}
        Создать аккаунт
      </Button>
    </Form>
  )
}
