import { cache } from 'react'
import type { Meeting } from '@/lib/api'
import { apiGet } from './auth'

// Встречи текущего пользователя; API отдаёт их по возрастанию даты
export const getMeetings = cache(
  async (): Promise<Meeting[]> => (await apiGet<Meeting[]>('/meetings')) ?? [],
)
