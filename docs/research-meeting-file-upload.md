# Ресерч: как реализовать загрузку файлов встречи

**PRD:** @docs/prd-meeting-file-upload.md
**План:** @docs/plan-meeting-file-upload.md
**Дата:** 2026-11-03

Бенчмарков и пробной сборки не делалось. Всё, что касается памяти и стриминга, проверяется в фазах 2 и 4. Источники в вебе, кроме документации Next.js, — блоги.

## Главная находка: текущий прокси буферизует тело целиком

`apps/web/src/app/api/[...path]/route.ts` делает `body: await request.arrayBuffer()`: файл в 500 МБ целиком окажется в памяти Next.js. Это нарушает техническое ограничение PRD.

Для загрузки нужен отдельный route handler, который передаёт поток дальше:

```ts
// app/api/meetings/[id]/files/route.ts
export async function POST(request: NextRequest, { params }) {
  const upstream = await fetch(`${apiUrl()}/meetings/${id}/files`, {
    method: 'POST',
    headers: { 'Content-Type': ct, 'Content-Length': cl, Authorization: `Bearer ${token}` },
    body: request.body, // ReadableStream, без await
    duplex: 'half', // обязателен в Node fetch для потокового body
    cache: 'no-store',
  })
  return new NextResponse(upstream.body, { status: upstream.status /* ... */ })
}
```

- `duplex: 'half'` в типах `RequestInit` может отсутствовать — нужен небольшой каст.
- Конкретные маршруты имеют приоритет над catch-all `[...path]`, общий прокси трогать не нужно.
- Скачивание: отдать `upstream.body` с `Content-Disposition` и `Content-Type`. Сейчас общий прокси пересобирает только `Content-Type`, `Content-Disposition` потеряется — пробрасывать явно.

**Проверка фазы 4 (2026-11-03, `next dev`, Next 16.4.2).** Во временные route handlers (удалены) подставлялся sink на `localhost:3999`; файл отправлял `curl --limit-rate 6M` (30 МБ, около 5 с):

| Вариант | Длительность запроса на sink | Вывод |
| --- | --- | --- |
| `body: request.body` + `duplex: 'half'` | 4739 мс (≈ время отправки клиентом) | стримится, `proxy.ts` с `matcher: '/'` буферизацию на `/api/*` не включает |
| `body: await request.arrayBuffer()` (как сейчас в `[...path]`) | 14 мс | сначала буферизуется всё тело |

- Память на файле 500 МБ в dev: буферизующий вариант вырос на ~1,5 ГБ (около 3× размера файла), стримящий — на ~0,5 ГБ в первом прогоне и ~50 МБ во втором. RSS в dev шумный (GC, кэши Turbopack), поэтому как доказательство стриминга использовать тайминги, а не RSS. Повторить замер памяти на `next build && next start` перед релизом.
- Предупреждений про `proxyClientMaxBodySize` в консоли замечено не было (лог терминала с `pnpm dev` не просматривался). Запасной вариант на случай проблем: `proxyClientMaxBodySize: '500mb'`, но он вернёт буферизацию. Matcher `proxy.ts` на `/api` не расширять.
- `export const runtime = 'nodejs'` в route handler **нельзя**: с `cacheComponents` Next падает с ошибкой «Route segment config "runtime" is not compatible with `nextConfig.cacheComponents`». Route handlers и так работают в Node.js, `runtime` указывать не нужно.

## API: busboy напрямую или Multer

`@nestjs/platform-express` уже тянет `multer@2.4.0` и `busboy@1.6.0` транзитивно.

|                                           | Multer (`FileInterceptor` + `diskStorage`)        | Прямой `busboy` в контроллере                |
| ----------------------------------------- | ------------------------------------------------- | -------------------------------------------- |
| Стриминг на диск                          | да                                                | да                                           |
| Лимит 500 МБ                              | `limits.fileSize`, ошибка `LIMIT_FILE_SIZE`       | `limits.fileSize`, событие `limit` на потоке |
| Контроль над ошибками и статусом `failed` | слабее: файл пишется до начала работы контроллера | полный                                       |
| Вписывается в CQRS                        | плохо: файл уже на диске к моменту команды        | хорошо: поток передаётся в команду           |
| Зависимости                               | нет                                               | добавить `busboy` и `@types/busboy` явно     |

**Рекомендация: `busboy` напрямую.** Запись `uploading` создаётся до записи на диск, `failed` проставляется в `catch`, handler принимает поток и легко тестируется unit-тестом (в том числе «ошибка потока»). С Multer для 413 понадобился бы ещё exception filter, мапящий `MulterError`.

Схема handler'а:

1. Проверить владельца встречи (404 для чужой) **до** чтения тела.
2. Создать запись `uploading` и сгенерированное имя `randomUUID()` (без расширения и исходного имени).
3. `pipeline(file, лимитирующий Transform, createWriteStream(path, { flags: 'wx' }))` из `stream/promises` — корректно разрушает все потоки при ошибке.
4. Успех: `uploaded` и фактический размер. Любая ошибка: `unlink` и `failed`.
5. Обрыв соединения: ловить `close`/`aborted` у запроса и ошибку пайплайна.

Нюансы:

- **413.** Проверка `Content-Length` — быстрый отказ, но верить заголовку нельзя: считать фактические байты. По событию `limit` у busboy завершить пайплайн ошибкой, удалить файл, вернуть `PayloadTooLargeException`.
- **Один файл за запрос** (`limits: { files: 1 }`): клиент шлёт файлы по одному. Один запрос — одна запись.
- **Кодировка имени.** busboy 1.x отдаёт имя в latin1; для кириллицы нужен `defParamCharset: 'utf8'`, иначе в БД попадёт мусор. Тесты на ASCII это не поймают — нужен e2e с кириллическим именем.
- **Скачивание.** `StreamableFile` из Nest и `Content-Disposition` с `filename*=UTF-8''...` (RFC 5987).
- **Каталог хранения.** Переменная окружения (например `UPLOADS_DIR`, дефолт `./uploads`, в `.gitignore`), перед записью `mkdir(recursive)`. Подкаталог `<meetingId>/` упрощает очистку при удалении встречи.
- **БД и диск.** `onDelete: Cascade` в Prisma файлы с диска не уберёт — удалять каталог встречи явно. Порядок: сначала запись в БД, потом файл (сирота на диске лучше битой ссылки в БД).
- **Зависшие `uploading`.** Если API упал посреди загрузки, запись останется в `uploading` навсегда. Дешёвое решение: при старте API помечать такие записи `failed` и удалять их файлы.
- **Тесты.** В e2e гонять 500 МБ не нужно. Лимит делаем настраиваемым (`MAX_UPLOAD_BYTES`, дефолт 500 МБ) и проверяем 413 на маленьких файлах. Реальную проверку памяти — один раз вручную скриптом.

## Браузер: прогресс загрузки

`fetch` не умеет давать прогресс отправки. Практичный вариант — `XMLHttpRequest` с `xhr.upload.onprogress`: один XHR на файл даёт независимые прогресс и статусы, повтор после ошибки — новый XHR.

- Тело — `FormData` с одним полем `file`; `Content-Type` вручную не ставить (браузер добавит boundary).
- `request()` в `lib/api.ts` принудительно ставит `application/json`, поэтому загрузку делать вне него.
- Обёртку над XHR вынести отдельной функцией (`onProgress`, `abort`, промис) и подменять в тестах jsdom.

## Что не нужно

- S3 и presigned URL — вне скоупа. На будущее держать запись на диск за маленьким интерфейсом (`saveStream`, `openStream`, `remove`).
- Chunked/resumable-загрузка (tus и подобное) — вне скоупа.
- Отдельный пакет для drag-and-drop: хватит `onDrop`/`onDragOver` и компонентов HeroUI (детали — по документации HeroUI в фазе 5).

## Изменения плана по итогам ресерча

1. Фаза 1: выбор `busboy`, один файл за запрос, `defParamCharset: 'utf8'`, e2e с кириллическим именем.
2. Фаза 2: настраиваемый лимит `MAX_UPLOAD_BYTES`; пометка зависших `uploading` при старте API.
3. Фаза 3: `Content-Disposition` с `filename*`.
4. Фаза 4: задача на проверку буферизации Next на файле 500 МБ; потоковый `fetch` с `duplex: 'half'`, проброс `Content-Disposition`.
5. Фаза 5: XHR с `upload.onprogress` и `FormData`.
6. Фаза 6: документация включает `MAX_UPLOAD_BYTES`.

## Источники

- [Next.js: proxyClientMaxBodySize](https://nextjs.org/docs/app/api-reference/config/next-config-js/proxyClientMaxBodySize)
- [Next.js File Upload Size Limit: Server Actions and Route Handlers Guide](https://fast.io/resources/nextjs-file-upload-size-limit.md)
- [Multer File Size Limit: Handling Large Uploads in Node.js and Express](https://fast.io/resources/multer-file-size-limit.md)
- [Node.js streaming file uploads (oneuptime)](https://oneuptime.com/blog/post/2026-01-30-nodejs-streaming-file-uploads/view)
