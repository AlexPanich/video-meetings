const TOKEN_KEY = 'access-token'

export const getToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export const setToken = (token: string) => {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // хранилище недоступно (приватный режим) — сессия живёт до перезагрузки
  }
}

export const clearToken = () => {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // ничего не делаем
  }
}
