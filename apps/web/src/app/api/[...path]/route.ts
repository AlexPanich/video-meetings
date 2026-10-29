import { type NextRequest, NextResponse } from 'next/server'
import { apiUrl, AUTH_COOKIE, unavailable } from '@/lib/server/auth'

// Прокси к API: подставляет JWT из HttpOnly-cookie в Authorization
const handler = async (
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) => {
  const { path } = await params
  const headers = new Headers()
  const contentType = request.headers.get('content-type')
  if (contentType) headers.set('Content-Type', contentType)
  const token = request.cookies.get(AUTH_COOKIE)?.value
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  let upstream: Response
  try {
    upstream = await fetch(`${apiUrl()}/${path.join('/')}${request.nextUrl.search}`, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: 'no-store',
    })
  } catch {
    return unavailable()
  }

  const response = new NextResponse(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
  })
  // токен отклонён API — сбрасываем cookie, чтобы proxy.ts снова считал пользователя гостем
  if (upstream.status === 401) response.cookies.delete(AUTH_COOKIE)
  return response
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE }
