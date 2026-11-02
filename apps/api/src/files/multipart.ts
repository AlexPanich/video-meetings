import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Readable } from 'node:stream'
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common'
import busboy, { type FileInfo } from 'busboy'

export const FILE_FIELD = 'file'

// запас на границы и заголовки multipart сверх размера самого файла
const MULTIPART_OVERHEAD = 64 * 1024

interface ReceiveOptions<T> {
  maxSize: number
  // сохраняет поток файла; при ошибке сама убирает за собой
  onFile: (stream: Readable, info: FileInfo) => Promise<T>
  // вызывается, если файл уже сохранён, но запрос всё равно отклонён (например, второй файл)
  rollback?: (result: T) => Promise<void>
}

/**
 * Читает multipart-запрос с ровно одним файлом в поле `file` и отдаёт поток в `onFile`.
 * Любая ошибка (лимит размера, лишний файл, не то поле, обрыв соединения, битое тело)
 * останавливает чтение, прерывает запись файла и отклоняет промис после очистки.
 */
export function receiveSingleFile<T>(
  request: IncomingMessage,
  { maxSize, onFile, rollback }: ReceiveOptions<T>,
): Promise<T> {
  return new Promise<T>((resolveOuter, rejectOuter) => {
    // после завершения (успеха или отказа) поздние события запроса уже ни на что не влияют
    let done = false
    const resolve = (value: T) => {
      done = true
      resolveOuter(value)
    }
    const reject = (error: Error) => {
      done = true
      rejectOuter(error)
    }
    // после отказа не дочитываем остаток тела: соединение закроется вместе с ответом
    const closeAfterResponse = () => {
      ;(request as IncomingMessage & { res?: ServerResponse }).res?.setHeader(
        'Connection',
        'close',
      )
    }

    const tooLarge = () =>
      new PayloadTooLargeException(`Размер файла превышает лимит ${maxSize} байт`)

    // честный клиент отсекается сразу, не дожидаясь начала загрузки
    if (Number(request.headers['content-length']) > maxSize + MULTIPART_OVERHEAD) {
      closeAfterResponse()
      reject(tooLarge())
      return
    }

    // клиент мог отключиться, пока проверялся владелец: событий close/error уже не будет
    if (request.destroyed) {
      reject(new BadRequestException('Загрузка прервана'))
      return
    }

    let parser: busboy.Busboy
    try {
      // fields: 0 — текстовые поля не нужны; defParamCharset нужен, чтобы кириллица в имени не ломалась
      parser = busboy({
        headers: request.headers,
        defParamCharset: 'utf8',
        // busboy шлёт `limit` уже на файле ровно в fileSize байт, а допустимо ровно maxSize: берём на байт больше
        limits: { files: 1, fields: 0, fileSize: maxSize + 1 },
      })
    } catch {
      reject(new BadRequestException('Ожидается multipart/form-data'))
      return
    }

    let fileStream: Readable | undefined
    let stored: Promise<T> | undefined
    let failed = false

    const fail = (error: Error) => {
      if (failed || done) return
      failed = true
      closeAfterResponse()
      request.unpipe(parser)
      request.resume()
      // уже дочитанный поток трогать нельзя: destroy(error) выбросит необработанный 'error'
      if (fileStream && !fileStream.destroyed && !fileStream.readableEnded)
        fileStream.destroy(error)
      // сначала дожидаемся, пока запись файла завершится или откатится
      const settled = stored ?? Promise.resolve(undefined)
      void settled
        .then(
          (result) => (result === undefined ? undefined : rollback?.(result)),
          () => undefined,
        )
        .catch(() => undefined)
        .then(() => reject(error))
    }

    parser.on('file', (field, stream, info) => {
      if (failed) {
        stream.resume()
        return
      }
      if (field !== FILE_FIELD) {
        stream.resume()
        fail(new BadRequestException(`Файл нужно передавать в поле "${FILE_FIELD}"`))
        return
      }
      fileStream = stream
      stream.on('error', () => undefined) // ошибку получает pipeline в onFile
      stream.on('limit', () => fail(tooLarge()))
      stored = onFile(stream, info)
      stored.catch(fail) // сбой записи (БД, диск) должен отклонить запрос, а не повиснуть
    })
    parser.on('filesLimit', () => fail(new BadRequestException('Допускается один файл за запрос')))
    parser.on('error', () => fail(new BadRequestException('Некорректное тело multipart-запроса')))
    parser.on('close', () => {
      if (failed) return
      if (!stored) {
        reject(new BadRequestException('Файл не передан'))
        return
      }
      stored.then(resolve, reject)
    })

    // клиент оборвал соединение до конца тела: парсер сам об этом не узнает
    request.on('error', () => fail(new BadRequestException('Загрузка прервана')))
    request.on('close', () => {
      if (!request.complete) fail(new BadRequestException('Загрузка прервана'))
    })
    request.pipe(parser)
  })
}
