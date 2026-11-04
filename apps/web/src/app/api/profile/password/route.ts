import { type NextRequest, NextResponse } from 'next/server'
import { apiUrl, AUTH_COOKIE, setAuthCookie, unavailable } from '@/lib/server/auth'

// Смена пароля: API отзывает все прежние токены и выдаёт новый. Общий прокси `[...path]` cookie
// не ставит, поэтому текущая сессия оборвалась бы; здесь новый JWT уходит только в HttpOnly-cookie
export const PUT = async (request: NextRequest) => {
  const token = request.cookies.get(AUTH_COOKIE)?.value
  if (!token) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

  let upstream: Response
  try {
    upstream = await fetch(`${apiUrl()}/profile/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: await request.text(),
      cache: 'no-store',
    })
  } catch {
    return unavailable()
  }

  const body = await upstream.json().catch(() => null)
  if (!upstream.ok || !body?.accessToken) {
    const response = NextResponse.json(body ?? { message: 'Что-то пошло не так' }, {
      status: upstream.ok ? 502 : upstream.status,
    })
    if (upstream.status === 401) response.cookies.delete(AUTH_COOKIE)
    return response
  }
  const response = NextResponse.json({ user: body.user })
  setAuthCookie(response, body.accessToken)
  return response
}
