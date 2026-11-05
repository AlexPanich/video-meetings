import { NextRequest, NextResponse } from 'next/server'
import { apiUrl, AUTH_COOKIE } from '@/lib/server/auth'

// Выход: API отзывает все токены пользователя, cookie сбрасывается в любом случае
// (даже если API недоступен: локально выйти нужно всегда)
export const POST = async (request: NextRequest) => {
  const token = request.cookies.get(AUTH_COOKIE)?.value
  if (token) {
    try {
      await fetch(`${apiUrl()}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
    } catch {
      // токен истечёт сам; cookie всё равно сбрасываем
    }
  }
  const response = new NextResponse(null, { status: 204 })
  response.cookies.delete(AUTH_COOKIE)
  return response
}
