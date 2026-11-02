// RFC 5987: encodeURIComponent оставляет ! ' ( ) * нетронутыми, а в filename* они недопустимы
const encodeRfc5987 = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )

/**
 * Заголовок Content-Disposition для скачивания под исходным именем: `filename*` (UTF-8)
 * для современных клиентов и ASCII-запасной `filename` для остальных.
 * Всегда `attachment`: браузер не должен открывать пользовательский файл на нашем origin.
 */
export function attachmentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\%]/g, '_')
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(name)}`
}
