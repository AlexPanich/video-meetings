import { ApiError } from './api'

// Лимит одного файла — как MAX_UPLOAD_BYTES в API (по умолчанию 500 МиБ)
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024

export interface UploadOptions {
  onProgress?: (loaded: number, total: number) => void
  signal?: AbortSignal
}

const abortError = () => new DOMException('Загрузка прервана', 'AbortError')

const errorMessage = (responseText: string) => {
  try {
    const body = JSON.parse(responseText)
    const message = Array.isArray(body?.message) ? body.message[0] : body?.message
    if (typeof message === 'string' && message) return message
  } catch {
    // тело не JSON — берём общее сообщение
  }
  return 'Что-то пошло не так'
}

// Загрузка одного файла на `/api/meetings/:id/files`. Идёт через XMLHttpRequest, а не fetch:
// только он сообщает о прогрессе отправки (`upload.onprogress`). Вне `request()` из `api.ts`,
// потому что тело — `FormData` (Content-Type с boundary выставляет браузер), а не JSON.
export function uploadFile(
  meetingId: string,
  file: File,
  { onProgress, signal }: UploadOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    const xhr = new XMLHttpRequest()
    const onAbort = () => xhr.abort()
    const cleanup = () => signal?.removeEventListener('abort', onAbort)

    xhr.open('POST', `/api/meetings/${encodeURIComponent(meetingId)}/files`)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total)
    }
    xhr.onload = () => {
      cleanup()
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new ApiError(errorMessage(xhr.responseText), xhr.status))
    }
    xhr.onerror = () => {
      cleanup()
      reject(new ApiError('Не удалось связаться с сервером', 0))
    }
    xhr.onabort = () => {
      cleanup()
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    const body = new FormData()
    body.append('file', file, file.name)
    xhr.send(body)
  })
}
