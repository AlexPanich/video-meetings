import { cache } from 'react'
import type { Meeting } from '@/lib/api'
import { type ApiResult, apiGet, apiRequest } from './auth'

// id встречи — uuid; всё остальное (в том числе `.` и `..`, которые fetch нормализует в другой путь)
// в API не отправляем
const MEETING_ID = /^[0-9a-zA-Z-]+$/

const isMeeting = (value: unknown): value is Meeting =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Meeting).id === 'string' &&
  Array.isArray((value as Meeting).participants)

// Встреча текущего пользователя. Причина отказа сохраняется: 401 — войти заново, 404 — встречи нет
// или она чужая, остальное (5xx, сеть) — временный сбой, а не «не найдено»
export const getMeeting = cache(async (id: string): Promise<ApiResult<Meeting>> => {
  if (!MEETING_ID.test(id)) return { ok: false, status: 404 }
  const result = await apiRequest<unknown>(`/meetings/${id}`)
  if (!result.ok) return result
  // ответ другой формы (например, список вместо встречи) — это не наша встреча
  return isMeeting(result.data) ? { ok: true, data: result.data } : { ok: false, status: 404 }
})

// Встречи текущего пользователя; API отдаёт их по возрастанию даты
export const getMeetings = cache(
  async (): Promise<Meeting[]> => (await apiGet<Meeting[]>('/meetings')) ?? [],
)
