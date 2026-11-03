export interface User {
  id: string
  email: string
  name: string
}

export interface Meeting {
  id: string
  title: string
  date: string
  participants: string[]
  ownerId: string
}

export type FileStatus = 'uploading' | 'uploaded' | 'failed'

export interface MeetingFile {
  id: string
  meetingId: string
  name: string
  size: number
  mimeType: string
  status: FileStatus
  createdAt: string
}

export interface AuthResult {
  user: User
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

// Запросы идут через route handlers Next (`/api/*`): JWT живёт в HttpOnly-cookie и добавляется на сервере
const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    throw new ApiError('Не удалось связаться с сервером', 0)
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const message = Array.isArray(body?.message) ? body.message[0] : body?.message
    throw new ApiError(message ?? 'Что-то пошло не так', response.status)
  }
  return response.status === 204 ? (undefined as T) : response.json()
}

export const login = (email: string, password: string) =>
  request<AuthResult>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })

export const register = (name: string, email: string, password: string) =>
  request<AuthResult>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  })

export const getMe = () => request<User>('/auth/me')

export const logout = () => request<void>('/auth/logout', { method: 'POST' })

export const getMeetingFiles = (meetingId: string) =>
  request<MeetingFile[]>(`/meetings/${encodeURIComponent(meetingId)}/files`, { cache: 'no-store' })
