'use client'

import { Button } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { logout } from '@/lib/api'

export function LogoutButton() {
  const router = useRouter()

  const onPress = async () => {
    await logout().catch(() => undefined)
    router.replace('/login')
  }

  return (
    <Button variant="secondary" onPress={onPress}>
      Выйти
    </Button>
  )
}
