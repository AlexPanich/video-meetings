'use client'

import { Alert, Button, Form, Spinner } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { type SyntheticEvent, useEffect, useRef, useState } from 'react'
import { ApiError, changePassword } from '@/lib/api'
import { PasswordField } from './password-field'

// Те же границы, что у API (PASSWORD_MAX_LENGTH); длина считается по символам, как в class-validator
const MIN_LENGTH = 8
const MAX_LENGTH = 128

export function ChangePasswordForm({ email }: { email: string }) {
  const router = useRouter()
  const submitting = useRef(false)
  // false, пока страница скрыта: поздний ответ запроса не должен менять состояние при возврате
  const active = useRef(false)
  // меняется после успеха и при скрытии: поля пересоздаются вместе с ошибками и режимом показа
  const [formKey, setFormKey] = useState(0)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [pending, setPending] = useState(false)

  // Next 16 скрывает ушедшую страницу, а не размонтирует: пароли не должны дожидаться возвращения
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      setCurrent('')
      setNext('')
      setRepeat('')
      setError(null)
      setSuccess(false)
      setFormKey((key) => key + 1)
    }
  }, [])

  const validateNew = (value: string) => {
    const length = [...value].length
    if (length < MIN_LENGTH) return `Пароль должен быть не короче ${MIN_LENGTH} символов`
    if (length > MAX_LENGTH) return `Пароль должен быть не длиннее ${MAX_LENGTH} символов`
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
      if (!active.current) return
      setCurrent('')
      setNext('')
      setRepeat('')
      setFormKey((key) => key + 1)
      setSuccess(true)
    } catch (e) {
      if (!active.current) return
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
    <div className="flex flex-col gap-5">
      <h2 className="text-lg font-semibold">Смена пароля</h2>
      {error && (
        <Alert status="danger" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      {success && (
        <Alert status="success" role="status">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>Пароль изменён</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {/* method="post": до гидратации браузер не должен отправить пароли GET-запросом в URL */}
      <Form key={formKey} method="post" className="flex flex-col gap-5" onSubmit={onSubmit}>
        {/* без name: аккаунт нужен менеджеру паролей, а не серверу */}
        <input type="text" autoComplete="username" value={email} readOnly hidden />
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
    </div>
  )
}
