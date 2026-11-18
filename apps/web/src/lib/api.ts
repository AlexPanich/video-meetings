export interface User {
  id: string
  email: string
  name: string
  hasAvatar: boolean
  avatarVersion: number | null
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

// `transcribing` — API транскрибирует аудио и видео встречи перед генерацией
export type SummaryStatus = 'pending' | 'transcribing' | 'generating' | 'done' | 'failed'

export interface SummaryActionItem {
  task: string
  assignee?: string
  dueDate?: string
}

export interface SummaryResult {
  summary: string
  decisions: string[]
  actionItems: SummaryActionItem[]
  openQuestions: string[]
  skippedFiles: { id: string; name: string }[]
}

export interface MeetingSummary {
  meetingId: string
  status: SummaryStatus
  // последнее успешное саммари: при пересоздании остаётся прежним до успеха
  result: SummaryResult | null
  error: string | null
  createdAt: string
  updatedAt: string
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

// Nest отдаёт `message` строкой или массивом строк (ошибки валидации)
export const extractErrorMessage = (body: unknown): string | undefined => {
  const message = (body as { message?: unknown } | null)?.message
  const first = Array.isArray(message) ? message[0] : message
  return typeof first === 'string' && first ? first : undefined
}

// Запросы идут через route handlers Next (`/api/*`): JWT живёт в HttpOnly-cookie и добавляется на сервере
const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      // JSON-заголовок только у строкового тела: у FormData Content-Type с boundary выставляет браузер
      headers: typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : undefined,
    })
  } catch {
    throw new ApiError('Не удалось связаться с сервером', 0)
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(extractErrorMessage(body) ?? 'Что-то пошло не так', response.status)
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

export const updateProfileName = (name: string) =>
  request<User>('/profile', { method: 'PATCH', body: JSON.stringify({ name }) })

// Новый JWT ставится в HttpOnly-cookie на сервере (`/api/profile/password`), клиенту отдаётся только user
export const changePassword = (currentPassword: string, newPassword: string) =>
  request<AuthResult>('/profile/password', {
    method: 'PUT',
    body: JSON.stringify({ currentPassword, newPassword }),
  })

export const uploadAvatar = (file: File) => {
  const body = new FormData()
  body.append('file', file, file.name)
  return request<User>('/profile/avatar', { method: 'PUT', body })
}

export const deleteAvatar = () => request<void>('/profile/avatar', { method: 'DELETE' })

export const logout = () => request<void>('/auth/logout', { method: 'POST' })

// Путь файловых эндпоинтов встречи (без префикса `/api`)
export const meetingFilesPath = (meetingId: string) =>
  `/meetings/${encodeURIComponent(meetingId)}/files`

export const getMeetingFiles = (meetingId: string) =>
  request<MeetingFile[]>(meetingFilesPath(meetingId), { cache: 'no-store' })

const filePath = (meetingId: string, fileId: string) =>
  `${meetingFilesPath(meetingId)}/${encodeURIComponent(fileId)}`

// Ссылка для скачивания: cookie уходит вместе с запросом, имя файла берётся из Content-Disposition
export const fileDownloadUrl = (meetingId: string, fileId: string) =>
  `/api${filePath(meetingId, fileId)}/download`

export const deleteMeetingFile = (meetingId: string, fileId: string) =>
  request<void>(filePath(meetingId, fileId), { method: 'DELETE' })

const summaryPath = (meetingId: string) => `/meetings/${encodeURIComponent(meetingId)}/summary`

// Саммари ещё не запускали (404) — `null`: это обычное состояние, а не ошибка
export const getMeetingSummary = async (meetingId: string): Promise<MeetingSummary | null> => {
  try {
    return await request<MeetingSummary>(summaryPath(meetingId), { cache: 'no-store' })
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

// Запуск или пересоздание; активная задача — ApiError 409
export const startMeetingSummary = (meetingId: string) =>
  request<MeetingSummary>(summaryPath(meetingId), { method: 'POST' })
