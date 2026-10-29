'use client'

import { Button, Skeleton } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { getMe, type User } from '@/lib/api'
import { clearToken, getToken } from '@/lib/session'

type State = { status: 'loading' } | { status: 'guest' } | { status: 'user'; user: User }

export function HomeActions() {
  const router = useRouter()
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    const load = async (): Promise<State> => {
      if (!getToken()) return { status: 'guest' }
      try {
        return { status: 'user', user: await getMe() }
      } catch {
        clearToken()
        return { status: 'guest' }
      }
    }
    load().then(setState)
  }, [])

  const logout = () => {
    clearToken()
    setState({ status: 'guest' })
  }

  if (state.status === 'loading') return <Skeleton className="h-10 w-48 rounded-xl" />

  if (state.status === 'user') {
    return (
      <div className="flex flex-col items-center gap-4">
        <p className="text-lg">
          Привет, <span className="font-semibold">{state.user.name}</span>!
        </p>
        <Button variant="secondary" onPress={logout}>
          Выйти
        </Button>
      </div>
    )
  }

  return (
    <div className="flex gap-3">
      <Button onPress={() => router.push('/login')}>Войти</Button>
      <Button variant="secondary" onPress={() => router.push('/register')}>
        Регистрация
      </Button>
    </div>
  )
}
