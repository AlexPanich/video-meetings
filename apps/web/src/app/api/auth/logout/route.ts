import { NextRequest, NextResponse } from 'next/server'
import { apiUrl, AUTH_COOKIE } from '@/lib/server/auth'

// Дольше API на выход не ждём: кнопка «Выйти» не должна зависать вместе с ним
const REVOKE_TIMEOUT_MS = 5000

// Выход: API отзывает все токены пользователя, cookie сбрасывается в любом случае
// (даже если API недоступен или завис: локально выйти нужно всегда). Сбой отзыва не скрывается:
// токены тогда действуют до истечения срока, поэтому он попадает в лог.
export const POST = async (request: NextRequest) => {
  const token = request.cookies.get(AUTH_COOKIE)?.value
  if (token) {
    try {
      const upstream = await fetch(`${apiUrl()}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
      })
      // 401 ожидаем: токен уже недействителен, отзывать нечего
      if (!upstream.ok && upstream.status !== 401) {
        console.error(`logout: API не отозвал токены, статус ${upstream.status}`)
      }
    } catch (error) {
      console.error('logout: не удалось отозвать токены в API', error)
    }
  }
  const response = new NextResponse(null, { status: 204 })
  response.cookies.delete(AUTH_COOKIE)
  return response
}
