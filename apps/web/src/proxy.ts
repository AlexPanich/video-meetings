import { NextResponse, type NextRequest } from 'next/server'
import { AUTH_COOKIE } from '@/lib/server/auth'

// Гость на закрытых страницах сразу уходит на /login, без показа страницы.
// Валидность токена проверяет API (см. UserGreeting); здесь — только наличие cookie.
export function proxy(request: NextRequest) {
  if (request.cookies.has(AUTH_COOKIE)) return NextResponse.next()
  return NextResponse.redirect(new URL('/login', request.url))
}

export const config = {
  matcher: '/',
}
