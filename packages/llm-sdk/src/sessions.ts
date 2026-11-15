// Хранилище сессий: интерфейс `SessionStore` (как в оригинале), реализация в памяти и перевод
// истории сессии в записи хранилища и обратно (`resume`, `continue`, `forkSession`).
import { randomUUID } from 'node:crypto'
import { untilAborted } from './abort.js'
import type { OllamaMessage, OllamaToolCall } from './ollama.js'
import { isRecord } from './session.js'
import type { Options, SessionKey, SessionStore, SessionStoreEntry } from './types.js'

/**
 * Хранилище в памяти процесса (как `InMemorySessionStore` оригинала): записи хранятся копиями,
 * после выхода из процесса теряются. Им же пользуется `query()` без `options.sessionStore`.
 */
export class InMemorySessionStore implements SessionStore {
  protected readonly store = new Map<string, SessionStoreEntry[]>()
  /** Порядок ключей — от давно изменённых к недавним (ключ переставляется в конец при записи). */
  protected readonly mtimes = new Map<string, number>()
  private lastMtime = 0

  private keyToString(key: SessionKey): string {
    return JSON.stringify([key.projectKey, key.sessionId, key.subpath ?? null])
  }

  append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    const id = this.keyToString(key)
    const existing = this.store.get(id)
    if (existing) existing.push(...structuredClone(entries))
    else this.store.set(id, structuredClone(entries))
    // mtime растёт строго: две записи в одну миллисекунду не делят место «последней сессии».
    this.lastMtime = Math.max(Date.now(), this.lastMtime + 1)
    this.mtimes.delete(id)
    this.mtimes.set(id, this.lastMtime)
    return Promise.resolve()
  }

  load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    const entries = this.store.get(this.keyToString(key))
    return Promise.resolve(entries ? structuredClone(entries) : null)
  }

  listSessions(projectKey: string): Promise<Array<{ sessionId: string; mtime: number }>> {
    const sessions: Array<{ sessionId: string; mtime: number }> = []
    for (const [id, mtime] of this.mtimes) {
      const [project, sessionId, subpath] = JSON.parse(id) as [string, string, string | null]
      if (project === projectKey && subpath === null) sessions.push({ sessionId, mtime })
    }
    return Promise.resolve(sessions)
  }

  delete(key: SessionKey): Promise<void> {
    const id = this.keyToString(key)
    this.store.delete(id)
    this.mtimes.delete(id)
    return Promise.resolve()
  }

  listSubkeys(key: { projectKey: string; sessionId: string }): Promise<string[]> {
    const subkeys: string[] = []
    for (const id of this.store.keys()) {
      const [project, sessionId, subpath] = JSON.parse(id) as [string, string, string | null]
      if (project === key.projectKey && sessionId === key.sessionId && subpath !== null) {
        subkeys.push(subpath)
      }
    }
    return Promise.resolve(subkeys)
  }

  /** Для тестов: записи по ключу. */
  getEntries(key: SessionKey): SessionStoreEntry[] {
    return structuredClone(this.store.get(this.keyToString(key)) ?? [])
  }

  /** Для тестов: число сессий (без подпутей). */
  get size(): number {
    let count = 0
    for (const id of this.store.keys()) {
      if ((JSON.parse(id) as unknown[])[2] === null) count += 1
    }
    return count
  }

  /** Для тестов: очистить хранилище. */
  clear(): void {
    this.store.clear()
    this.mtimes.clear()
  }
}

/** Сколько сессий держит хранилище по умолчанию: старые вытесняются, память процесса не растёт. */
export const DEFAULT_STORE_MAX_SESSIONS = 100

/** Хранилище по умолчанию: как `InMemorySessionStore`, но не больше `maxSessions` ключей. */
class BoundedSessionStore extends InMemorySessionStore {
  constructor(private readonly maxSessions: number) {
    super()
  }

  override async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    await super.append(key, entries)
    for (const id of this.mtimes.keys()) {
      if (this.mtimes.size <= this.maxSessions) break
      this.mtimes.delete(id)
      this.store.delete(id)
    }
  }
}

/** Хранилище `query()` без `options.sessionStore`: общее на процесс. */
const defaultStore = new BoundedSessionStore(DEFAULT_STORE_MAX_SESSIONS)

/** Таймаут `load()`/`listSessions()` хранилища по умолчанию, как `loadTimeoutMs` оригинала. */
export const DEFAULT_LOAD_TIMEOUT_MS = 60_000

/** Тип записи хранилища с сообщением истории (формат локального SDK). */
const MESSAGE_ENTRY = 'ollama_message'

/** Область сессий: как в оригинале по умолчанию — cwd, приведённый к безопасным символам. */
export function projectKey(): string {
  return process.cwd().replace(/[^a-zA-Z0-9]/g, '-')
}

/** Сессия, к которой подключился `query()`: id, хранилище и ещё не записанная часть истории. */
export interface SessionLink {
  id: string
  store: SessionStore
  projectKey: string
  /**
   * История сессии: сначала из хранилища (у новой — пустая), дальше её дополняет `query()`.
   * Системный промпт в ней есть, но в хранилище не пишется.
   */
  history: OllamaMessage[]
  /** `resume`/`continue` нашли сессию: хук `SessionStart` получает `source: resume`. */
  resumed: boolean
  /** Сколько сообщений истории (без системного промпта) уже в хранилище под `id`. */
  persisted: number
  /** `persistSession: false`: ходы в хранилище не пишутся. */
  readOnly: boolean
}

/**
 * Находит сессию по `resume` или последнюю по `continue` и загружает её историю; с
 * `forkSession` история уходит в новую сессию, исходная не меняется. Неизвестный `resume` —
 * ошибка с этим id. Вызовы хранилища ограничены `loadTimeoutMs` и отменяются `signal`.
 */
export async function openSession(options: Options, signal: AbortSignal): Promise<SessionLink> {
  if (options.persistSession === false && options.sessionStore) {
    // Как в оригинале: хранилище там — зеркало локальной записи, без неё не работает.
    throw new Error('sessionStore cannot be used with persistSession: false')
  }
  const store = options.sessionStore ?? defaultStore
  const project = projectKey()
  const call = <T>(name: string, promise: Promise<T>) =>
    withTimeout(name, promise, options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS, signal)
  let sourceId = options.resume
  if (sourceId === undefined && options.continue) {
    sourceId = await latestSession(store, project, call)
  }
  const readOnly = options.persistSession === false
  if (sourceId === undefined) {
    return {
      id: randomUUID(),
      store,
      projectKey: project,
      history: [],
      resumed: false,
      persisted: 0,
      readOnly,
    }
  }
  const entries = await call('load', store.load({ projectKey: project, sessionId: sourceId }))
  if (entries === null) throw new Error(`No conversation found with session ID: ${sourceId}`)
  const restored = entries.flatMap(fromEntry)
  if (entries.length > 0 && restored.length === 0) {
    // Иначе сессия молча продолжилась бы без контекста: например, её записал провайдер
    // anthropic в то же хранилище.
    throw new Error(`Session ${sourceId} has no entries readable by the local SDK`)
  }
  const skipped = entries.length - restored.length
  if (skipped > 0) {
    process.emitWarning(
      `Session ${sourceId}: ${skipped} of ${entries.length} store entries are not readable by the local SDK and were skipped`,
    )
  }
  const fork = options.forkSession === true
  return {
    id: fork ? randomUUID() : sourceId,
    store,
    projectKey: project,
    history: restored,
    resumed: true,
    // Ответвление пишет всю историю под новым id при первом сохранении.
    persisted: fork ? 0 : restored.length,
    readOnly,
  }
}

/** Ждёт вызов хранилища не дольше `timeoutMs` и до отмены сессии. */
async function withTimeout<T>(
  name: string,
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<T> {
  const timeout = new AbortController()
  const timer = setTimeout(
    () => timeout.abort(new Error(`sessionStore.${name}() timed out after ${timeoutMs} ms`)),
    timeoutMs,
  )
  try {
    return await untilAborted(promise, AbortSignal.any([signal, timeout.signal]))
  } finally {
    clearTimeout(timer)
  }
}

async function latestSession(
  store: SessionStore,
  project: string,
  call: <T>(name: string, promise: Promise<T>) => Promise<T>,
): Promise<string | undefined> {
  if (!store.listSessions) {
    throw new Error('options.continue requires a sessionStore with listSessions()')
  }
  const sessions = await call('listSessions', store.listSessions(project))
  let latest: { sessionId: string; mtime: number } | undefined
  for (const session of sessions) {
    if (!latest || session.mtime > latest.mtime) latest = session
  }
  return latest?.sessionId
}

/**
 * Дописывает в хранилище сообщения истории, которых там ещё нет. Вызывается в конце хода (перед
 * `result`), поэтому прерванный ход не сохраняется. Системный промпт не пишется: его задаёт каждый
 * `query()` заново.
 */
export async function persistSession(link: SessionLink): Promise<void> {
  if (link.readOnly) return
  const messages = link.history.filter((message) => message.role !== 'system')
  if (messages.length <= link.persisted) return
  const fresh = messages.slice(link.persisted)
  await link.store.append(
    { projectKey: link.projectKey, sessionId: link.id },
    fresh.map((message) => toEntry(link.id, message)),
  )
  link.persisted = messages.length
}

function toEntry(sessionId: string, message: OllamaMessage): SessionStoreEntry {
  return {
    type: MESSAGE_ENTRY,
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    // Без копии: `InMemorySessionStore` копирует записи сам, а сообщения истории SDK не меняет.
    message,
  }
}

/** Запись хранилища → сообщение истории; чужие и битые записи пропускаются. */
function fromEntry(entry: SessionStoreEntry): OllamaMessage[] {
  if (entry.type !== MESSAGE_ENTRY || !isRecord(entry.message)) return []
  const message = entry.message
  if (typeof message.content !== 'string') return []
  const toolCalls = message.tool_calls === undefined ? undefined : readToolCalls(message.tool_calls)
  // Вызовы не той формы Ollama отвергла бы HTTP 400 на каждом запросе сессии: запись битая.
  if (toolCalls === null) return []
  switch (message.role) {
    case 'user':
      return [{ role: 'user', content: message.content }]
    case 'assistant':
      return [
        {
          role: 'assistant',
          content: message.content,
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        },
      ]
    case 'tool':
      return typeof message.tool_name === 'string'
        ? [{ role: 'tool', content: message.content, tool_name: message.tool_name }]
        : []
    default:
      return []
  }
}

/** `tool_calls` из хранилища: массив `{ function: { name, arguments } }`, иначе `null`. */
function readToolCalls(value: unknown): OllamaToolCall[] | null {
  if (!Array.isArray(value)) return null
  const calls: OllamaToolCall[] = []
  for (const call of value) {
    if (!isRecord(call) || !isRecord(call.function)) return null
    const { name, arguments: args } = call.function
    if (typeof name !== 'string' || !(isRecord(args) || typeof args === 'string')) return null
    calls.push({ function: { name, arguments: args } })
  }
  return calls
}
