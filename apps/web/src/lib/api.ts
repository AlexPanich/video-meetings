import { getToken } from './session'

export interface User {
  id: string
  email: string
  name: string
}

export interface AuthResult {
  accessToken: string
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

// Запросы идут через rewrite Next (`/api/*` → бэкенд), поэтому CORS не нужен
const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const token = getToken()
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  } catch {
    throw new ApiError('Не удалось связаться с сервером', 0)
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const message = Array.isArray(body?.message) ? body.message[0] : body?.message
    throw new ApiError(message ?? 'Что-то пошло не так', response.status)
  }
  return response.json()
}

export const login = (email: string, password: string) =>
  request<AuthResult>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })

export const register = (name: string, email: string, password: string) =>
  request<AuthResult>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  })

export const getMe = () => request<User>('/auth/me')
