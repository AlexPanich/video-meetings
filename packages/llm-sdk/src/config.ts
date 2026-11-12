export const DEFAULT_OLLAMA_URL = 'http://localhost:11434'
export const DEFAULT_OLLAMA_MODEL = 'qwen3:14b'
export const DEFAULT_OLLAMA_NUM_CTX = 32768
export const DEFAULT_OLLAMA_TIMEOUT_MS = 300_000

export interface OllamaConfig {
  /** Базовый адрес без завершающего слэша. */
  url: string
  model: string
  numCtx: number
  timeoutMs: number
}

type Env = Record<string, string | undefined>

/** Читает настройки Ollama из env; некорректные значения — ошибка с именем переменной. */
export function readOllamaConfig(env: Env = process.env): OllamaConfig {
  return {
    url: baseUrl(nonEmpty(env.OLLAMA_URL) ?? DEFAULT_OLLAMA_URL),
    model: nonEmpty(env.OLLAMA_MODEL) ?? DEFAULT_OLLAMA_MODEL,
    numCtx: positiveInt(env, 'OLLAMA_NUM_CTX', DEFAULT_OLLAMA_NUM_CTX),
    timeoutMs: positiveInt(env, 'OLLAMA_TIMEOUT_MS', DEFAULT_OLLAMA_TIMEOUT_MS),
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function baseUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`OLLAMA_URL must be an http(s) URL, got "${raw}"`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`OLLAMA_URL must be an http(s) URL, got "${raw}"`)
  }
  // К адресу дописывается `/api/chat`: query или hash оказались бы перед путём.
  if (url.search || url.hash) {
    throw new Error(`OLLAMA_URL must not contain a query or hash, got "${raw}"`)
  }
  return raw.replace(/\/+$/, '')
}

function positiveInt(env: Env, name: string, fallback: number): number {
  const raw = nonEmpty(env[name])
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`)
  }
  return value
}
