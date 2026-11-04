import { type NextRequest, NextResponse } from 'next/server'
import { apiUrl, AUTH_COOKIE, setAuthCookie, unavailable } from '@/lib/server/auth'

// Смена пароля: API отзывает все прежние токены и выдаёт новый. Общий прокси `[...path]` cookie
// не ставит, поэтому текущая сессия оборвалась бы; здесь новый JWT уходит только в HttpOnly-cookie
export const PUT = async (request: NextRequest) => {
  const token = request.cookies.get(AUTH_COOKIE)?.value
  if (!token) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

  // тело идёт потоком, как в `[...path]`: без буферизации в памяти Next, лимит размера — у парсера API
  const body = request.body ?? undefined
  let upstream: Response
  try {
    const init: RequestInit & { duplex?: 'half' } = {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body,
      duplex: body ? 'half' : undefined,
      cache: 'no-store',
    }
    upstream = await fetch(`${apiUrl()}/profile/password`, init)
  } catch {
    return unavailable()
  }

  const result = await upstream.json().catch(() => null)
  if (!upstream.ok || !result?.accessToken) {
    const response = NextResponse.json(result ?? { message: 'Что-то пошло не так' }, {
      status: upstream.ok ? 502 : upstream.status,
    })
    if (upstream.status === 401) response.cookies.delete(AUTH_COOKIE)
    return response
  }
  const response = NextResponse.json({ user: result.user })
  setAuthCookie(response, result.accessToken)
  return response
}
