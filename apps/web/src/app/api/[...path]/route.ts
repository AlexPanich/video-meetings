import { type NextRequest, NextResponse } from 'next/server'
import { apiUrl, AUTH_COOKIE, unavailable } from '@/lib/server/auth'

// Заголовки ответа API, которые нужны браузеру как есть: тип, имя и размер скачиваемого файла,
// запрет определения типа по содержимому (nosniff) — без них файл откроется inline на нашем origin
const PASSTHROUGH_RESPONSE_HEADERS = [
  'content-type',
  'content-disposition',
  'content-length',
  'x-content-type-options',
]

// Прокси к API: подставляет JWT из HttpOnly-cookie в Authorization.
// Тело запроса и ответа идут потоком (загрузка и скачивание файлов до 500 МБ), в память не читаются.
const handler = async (
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) => {
  const { path } = await params
  const headers = new Headers()
  const contentType = request.headers.get('content-type')
  if (contentType) headers.set('Content-Type', contentType)
  // API отсекает слишком большой файл по Content-Length ещё до чтения тела
  const contentLength = request.headers.get('content-length')
  if (contentLength) headers.set('Content-Length', contentLength)
  const token = request.cookies.get(AUTH_COOKIE)?.value
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const body = request.body ?? undefined
  let upstream: Response
  try {
    // потоковое тело в fetch обязано быть помечено duplex: 'half' (в типах RequestInit его нет)
    const init: RequestInit & { duplex?: 'half' } = {
      method: request.method,
      headers,
      body,
      duplex: body ? 'half' : undefined,
      cache: 'no-store',
    }
    upstream = await fetch(`${apiUrl()}/${path.join('/')}${request.nextUrl.search}`, init)
  } catch {
    return unavailable()
  }

  const responseHeaders = new Headers({ 'Content-Type': 'application/json' })
  for (const name of PASSTHROUGH_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) responseHeaders.set(name, value)
  }
  // fetch сам распаковывает тело: длина сжатого ответа не подходит
  if (upstream.headers.has('content-encoding')) responseHeaders.delete('content-length')

  const response = new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  })
  // токен отклонён API — сбрасываем cookie, чтобы proxy.ts снова считал пользователя гостем
  if (upstream.status === 401) response.cookies.delete(AUTH_COOKIE)
  return response
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE }
