import { cache } from 'react'
import type { Meeting } from '@/lib/api'
import { apiGet } from './auth'

// Встречи текущего пользователя; API отдаёт их по возрастанию даты
// Встреча текущего пользователя; null — нет такой (или чужая), нет токена или API недоступен
export const getMeeting = cache(async (id: string) =>
  apiGet<Meeting>(`/meetings/${encodeURIComponent(id)}`),
)

export const getMeetings = cache(
  async (): Promise<Meeting[]> => (await apiGet<Meeting[]>('/meetings')) ?? [],
)
