import { cache } from 'react'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { User } from '@/lib/api'

export const AUTH_COOKIE = 'access-token'

export const apiUrl = () => process.env.API_URL ?? 'http://localhost:3001'

const jwtMaxAge = (token: string): number | undefined => {
  try {
    const { exp } = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    return typeof exp === 'number' ? Math.max(exp - Math.floor(Date.now() / 1000), 0) : undefined
  } catch {
    return undefined
  }
}

export const setAuthCookie = (response: NextResponse, token: string) =>
  response.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: jwtMaxAge(token),
  })

const unavailable = () =>
  NextResponse.json({ message: 'Не удалось связаться с сервером' }, { status: 502 })

// Логин/регистрация: JWT от API уходит только в HttpOnly-cookie, браузеру отдаём лишь пользователя
export const authenticate = async (path: string, request: Request): Promise<NextResponse> => {
  let upstream: Response
  try {
    upstream = await fetch(`${apiUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: await request.text(),
      cache: 'no-store',
    })
  } catch {
    return unavailable()
  }

  const body = await upstream.json().catch(() => null)
  if (!upstream.ok || !body?.accessToken) {
    return NextResponse.json(body ?? { message: 'Что-то пошло не так' }, {
      status: upstream.ok ? 502 : upstream.status,
    })
  }
  const response = NextResponse.json({ user: body.user })
  setAuthCookie(response, body.accessToken)
  return response
}

export { unavailable }

// Результат GET в API: данные или код ошибки. 401 — нет токена или он отклонён, 0 — API недоступен
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number }

// GET в API от имени текущего пользователя
export const apiRequest = async <T>(path: string): Promise<ApiResult<T>> => {
  const token = (await cookies()).get(AUTH_COOKIE)?.value
  if (!token) return { ok: false, status: 401 }
  try {
    const response = await fetch(`${apiUrl()}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!response.ok) return { ok: false, status: response.status }
    return { ok: true, data: (await response.json()) as T }
  } catch {
    return { ok: false, status: 0 }
  }
}

// То же, но без различия причин: null — нет токена, отказ API или сеть недоступна
export const apiGet = async <T>(path: string): Promise<T | null> => {
  const result = await apiRequest<T>(path)
  return result.ok ? result.data : null
}

// Текущий пользователь для серверных компонентов; null — гость или токен отклонён API
export const getCurrentUser = cache(() => apiGet<User>('/auth/me'))
