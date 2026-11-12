// Ожидание чужого кода (обработчики, хуки, canUseTool) с отменой через `interrupt()`.

/**
 * Ждёт `promise`, но не дольше срабатывания `signal`: после отмены отклоняется с
 * `signal.reason`, даже если чужой код сигнал не слушает и не завершается никогда.
 */
export function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason as Error)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason as Error)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        // Чужой код может отклонить чем угодно — передаём как есть.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject(error)
      },
    )
  })
}
