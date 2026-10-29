import { Link } from '@heroui/react'
import type { Metadata } from 'next'
import { AuthShell } from '@/components/auth-shell'
import { RegisterForm } from '@/components/register-form'

export const metadata: Metadata = { title: 'Регистрация — Video Meetings' }

export default function RegisterPage() {
  return (
    <AuthShell
      title="Создать аккаунт"
      description="Это займёт меньше минуты"
      footer={
        <span>
          Уже есть аккаунт? <Link href="/login">Войти</Link>
        </span>
      }
    >
      <RegisterForm />
    </AuthShell>
  )
}
