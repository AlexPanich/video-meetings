import { Link } from '@heroui/react'
import type { Metadata } from 'next'
import { AuthShell } from '@/components/auth-shell'
import { LoginForm } from '@/components/login-form'

export const metadata: Metadata = { title: 'Вход — Video Meetings' }

export default function LoginPage() {
  return (
    <AuthShell
      title="С возвращением"
      description="Войдите, чтобы продолжить"
      footer={
        <span>
          Нет аккаунта? <Link href="/register">Зарегистрироваться</Link>
        </span>
      }
    >
      <LoginForm />
    </AuthShell>
  )
}
