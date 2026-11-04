'use client'

import { Alert, Button, Form, Spinner } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { type SyntheticEvent, useEffect, useRef, useState } from 'react'
import { ApiError, changePassword } from '@/lib/api'
import { PasswordField } from './password-field'

const MIN_LENGTH = 8

export function ChangePasswordForm() {
  const router = useRouter()
  const submitting = useRef(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [pending, setPending] = useState(false)

  // Next 16 скрывает ушедшую страницу, а не размонтирует: пароли не должны дожидаться возвращения
  useEffect(
    () => () => {
      setCurrent('')
      setNext('')
      setRepeat('')
      setError(null)
      setSuccess(false)
    },
    [],
  )

  const validateNew = (value: string) => {
    if (value.length < MIN_LENGTH) return `Пароль должен быть не короче ${MIN_LENGTH} символов`
    if (value === current) return 'Новый пароль должен отличаться от текущего'
    return null
  }
  const validateRepeat = (value: string) => (value === next ? null : 'Пароли не совпадают')

  const onSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setPending(true)
    setError(null)
    setSuccess(false)
    try {
      await changePassword(current, next)
      setCurrent('')
      setNext('')
      setRepeat('')
      setSuccess(true)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace('/login')
        return
      }
      setError(e instanceof Error ? e.message : 'Что-то пошло не так')
    } finally {
      submitting.current = false
      setPending(false)
    }
  }

  return (
    <Form className="flex flex-col gap-5" onSubmit={onSubmit}>
      <h2 className="text-lg font-semibold">Смена пароля</h2>
      {error && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      {success && (
        <Alert status="success">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>Пароль изменён</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      <PasswordField
        label="Текущий пароль"
        placeholder="Введите текущий пароль"
        name="currentPassword"
        autoComplete="current-password"
        value={current}
        onChange={setCurrent}
      />
      <PasswordField
        label="Новый пароль"
        placeholder="Не короче 8 символов"
        name="newPassword"
        autoComplete="new-password"
        value={next}
        onChange={setNext}
        validate={validateNew}
      />
      <PasswordField
        label="Повторите новый пароль"
        placeholder="Повторите новый пароль"
        name="repeatPassword"
        autoComplete="new-password"
        value={repeat}
        onChange={setRepeat}
        validate={validateRepeat}
      />

      <Button type="submit" className="w-full" isPending={pending}>
        {pending ? <Spinner aria-label="Загрузка" color="current" size="sm" /> : null}
        Сменить пароль
      </Button>
    </Form>
  )
}
