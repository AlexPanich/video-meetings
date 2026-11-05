# CLAUDE.md — apps/api

Бэкенд `video-meetings`: NestJS 12 на Express, нативный ESM (`"type": "module"`, `module: nodenext`). Общие правила репозитория — в корневом `CLAUDE.md`.

## Команды

Запускать из корня через `pnpm --filter api <script>` или из этой папки через `pnpm <script>`:

- `build` — `nest build` (результат в `dist/`); `start:prod` — `node dist/main`
- `dev` — watch-режим с загрузкой корневого `.env` (его же запускает `pnpm dev` из корня); `start:dev` — алиас на `dev`; `start:debug` — watch + inspector
- `lint` — ESLint по `src` и `test`
- `test` — `vitest run` (unit); `test:watch`; `test:cov`; `test:debug`
- `test:e2e` — `vitest run --config ./vitest.config.e2e.ts`

Один тест: `pnpm --filter api test src/users/user.spec.ts`.

## ESM

- Относительные импорты **обязательно с расширением `.js`**: `import { AppModule } from './app.module.js'` (даже для `.ts`-файлов).
- `src/main.ts` использует top-level `await`.
- Не использовать `require`/`__dirname`; для путей — `import.meta.url`.

## Структура

- `src/main.ts` — bootstrap, порт `process.env.PORT ?? 3001` (web занимает 3000).
- `src/app.module.ts` — корневой модуль: подключает `PrismaModule`, `UsersModule`, `AuthModule`, `MeetingsModule`, `FilesModule`, `ProfileModule` и глобальный `ValidationPipe` (`APP_PIPE`, `whitelist` + `transform`). Корневого контроллера/сервиса нет (`GET /` → 404); новые фичи оформлять отдельными Nest-модулями (`nest g module`) и подключать в `AppModule`.
- `src/swagger.ts` — `setupSwagger(app)`: OpenAPI на `@nestjs/swagger` (UI `GET /docs`, JSON `GET /docs-json`, Bearer-авторизация). Вызывается в `main.ts`. Схемы DTO строит плагин Nest CLI из `nest-cli.json` (`esmCompatible`, файлы `dto.ts`), поэтому `@ApiProperty` в DTO не нужен; контроллеры помечать `@ApiTags(...)`, защищённые маршруты — `@ApiBearerAuth()`. Плагин работает только при `nest build`/`dev`; в vitest схемы полей DTO не генерируются.

**Модули**

- `src/auth` (CQRS) — `POST /auth/register`, `POST /auth/login`, `GET /auth/me`. `commands/` (`RegisterUser*`, `LoginUser*`), `queries/` (`GetCurrentUser*`), `TokenService` (выпуск JWT), `AuthController` (только `CommandBus`/`QueryBus`), `JwtAuthGuard` (проверяет подпись, `iss`/`aud` (`video-meetings-api`/`video-meetings`, задаются при подписи в `AuthModule`) и форму payload (`sub` — непустая строка, `ver` — целое или отсутствует, иначе 401), затем запросом `GetUserTokenVersionQuery` (читает одно поле, без `passwordHash`) сверяет `ver` из токена с `User.tokenVersion`: не совпало или пользователя нет → 401; токен без `ver` = версия 0; проверка идёт до обработчика, то есть до чтения тела при загрузке файлов), `dto.ts`, `password.ts` (scrypt с N=2^17; хеш `scrypt$N$r$p$salt$key` хранит параметры, старый формат `salt:key` проверяется как legacy; при успешном входе `LoginUserHandler` перехеширует устаревший хеш командой `UpgradeUserPasswordHash` модуля `users`, `tokenVersion` не меняется). Данные пользователей берёт у `users` через шины. `TokenService` кладёт в JWT `sub` и `ver` (`tokenVersion`). Экспортирует `JwtModule`, `JwtAuthGuard` и `TokenService` для других модулей.
- `src/users` (CQRS, без контроллера, владелец таблицы `User`; им пользуются `auth` и `profile`) — `commands/CreateUser*`, `UpdateUserName*`, `UpgradeUserPasswordHash*` (заменяет хеш без смены `tokenVersion`, только если хеш не менялся), `ChangeUserPassword*` (одним `update` меняет `passwordHash` и увеличивает `tokenVersion` при совпадении ожидаемой версии — защита от гонки; `null`, если пользователя нет или версия сменилась), `SetUserAvatar*` (записывает аватар и возвращает пользователя вместе с именем прежнего файла) и `ClearUserAvatar*` (очищает запись, возвращает имя удалённого файла); все три возвращают `null`, если пользователя нет, `queries/FindUserByEmail*`, `FindUserById*`, `GetUserTokenVersion*` (только `tokenVersion` или `null`, для гарда на каждый запрос). Возвращают сущность Prisma `User` с `passwordHash` — это внутренние сообщения, наружу их не отдавать. `user.ts` — `PublicUser` (`id`, `email`, `name`, `hasAvatar`, `avatarVersion` — мс от `avatarUpdatedAt` или `null`, для URL аватара без устаревшего кэша), `toPublicUser` (`UserLike` требует поля аватара: вызов без них не компилируется). `User.tokenVersion` (`Int`, по умолчанию 0) — версия сессий. Поля аватара в `User`: `avatarStorageName`, `avatarMimeType`, `avatarUpdatedAt` (все nullable, наружу отдаются только `hasAvatar`/`avatarVersion`).
- `src/meetings` (CQRS) — `POST /meetings`, `GET /meetings`, `GET /meetings/:id`, `DELETE /meetings/:id` (204; записи файлов удаляются каскадом, физические — командой `DeleteMeetingFiles` модуля `files` через `CommandBus`), всё под `JwtAuthGuard`; встречи видны только владельцу, чужая/несуществующая = 404. `commands/CreateMeeting*`, `DeleteMeeting*`, `queries/ListMeetings*`, `GetMeeting*`, модель Prisma `Meeting` (`participants` — `String[]`).
- `src/files` (CQRS) — файлы встреч: `POST /meetings/:meetingId/files` (multipart, один файл за запрос в поле `file`), `GET /meetings/:meetingId/files` (только файлы со статусом `uploaded`), `GET /meetings/:meetingId/files/:fileId/download`, `DELETE /meetings/:meetingId/files/:fileId` (204); под `JwtAuthGuard`, доступ только владельцу встречи: handlers проверяют его через `QueryBus` запросом `GetMeetingQuery` из `meetings` (чужая/несуществующая = 404). Загрузка: `commands/UploadMeetingFile*` проверяет владельца до чтения тела (поэтому команда несёт сырой `IncomingMessage` — осознанное исключение из правила «команда = данные»), затем `multipart.ts` (`receiveSingleFile`) парсит поток напрямую через `busboy` (`defParamCharset: 'utf8'`, не Multer) с лимитами: размер (`MAX_UPLOAD_BYTES` → 413, в том числе заранее по `Content-Length`), один файл, поле строго `file`, без текстовых полей; обрыв соединения и битое тело прерывают запись. Handler создаёт запись `MeetingFile` со статусом `uploading` и стримит файл на диск под `<UPLOADS_DIR>/<meetingId>/<uuid>` (исходное имя и `Content-Type` проходят через `sanitize.ts`: имя ≤ 255 символов без управляющих, MIME только корректный `type/subtype`, иначе `application/octet-stream`); при успехе статус `uploaded` и фактический размер, при любой ошибке `discard-file.ts` удаляет файл и ставит `failed` (сбои очистки логируются). `stale-uploads.cleaner.ts` при старте и затем каждые 10 минут закрывает записи, зависшие в `uploading` дольше 3 часов (упавший процесс; запас нужен для медленных загрузок). `orphan-files.ts` (вызывается из того же sweep) сверяет каталог хранения с БД и удаляет осиротевшее: каталоги несуществующих встреч и файлы без записи (остаются, если удаление с диска не удалось после удаления записи); трогает только имена-uuid. Если встречу удалили во время загрузки, upload отвечает 404 (P2003/P2025) и убирает за собой файл и пустой каталог. Серверный `requestTimeout` Node отключён в `main.ts` (`0`), иначе загрузка 500 МиБ на медленном канале обрывалась бы через 5 минут. Общая проверка «доступ к встрече + файл `uploaded` этой встречи, иначе 404» — `find-uploaded-file.ts`, удаление файла с диска — `stored-file.ts`. Скачивание: `queries/DownloadMeetingFile*` открывает файл один раз (`fs.open`, без гонки stat/open) и возвращает `StreamableFile` (поток с диска, `Content-Type` из БД, `Content-Length`, `Content-Disposition: attachment` с `filename*=UTF-8''…` из `content-disposition.ts`, контроллер добавляет `X-Content-Type-Options: nosniff`); отдаются только файлы `uploaded`, отсутствие файла на диске = 404. Удаление: `commands/DeleteMeetingFile*` сначала удаляет запись, затем файл (сбой удаления с диска логируется). `commands/DeleteMeetingFiles*` — внутренняя команда, удаляет каталог `<UPLOADS_DIR>/<meetingId>` (идентификатор обязан быть одним сегментом пути, иначе ошибка: защита рекурсивного `rm`). `storage.ts` — пути и лимит.
- `src/profile` (CQRS) — `PATCH /profile` (тело `{ name }`; под `JwtAuthGuard`, пользователь определяется только по токену, остальные поля тела игнорируются; ответ — `PublicUser`). Имя обрезается по краям и проверяется: не пустое, не длиннее 100 символов (`NAME_MAX_LENGTH`), без управляющих символов (включая нулевой байт, который Postgres не принимает), с хотя бы одной буквой или цифрой — иначе 400. Эти правила — общий декоратор `IsUserName` из `users/user-name.ts`, он же стоит на `name` в `RegisterDto` (там же `EMAIL_MAX_LENGTH` = 254 для email при регистрации). `commands/UpdateProfile*` пишет в `User` только через команду `UpdateUserName` модуля `users` по `CommandBus`; `dto.ts` (`UpdateProfileDto`, `PublicUserDto` — класс ради схемы ответа в Swagger). Читать профиль — `GET /auth/me`. Пароль: `PUT /profile/password` (тело `{ currentPassword, newPassword }`, новый — 8–128 символов (тот же лимит у пароля при регистрации) и не равен текущему → иначе 400; неверный текущий → **403**, а не 401, чтобы BFF не сбросил cookie; успех — 200 `{ accessToken, user }` как при входе). `commands/ChangePassword*` проверяет пароль, хеширует новый и шлёт `ChangeUserPassword` в `users` с версией, прочитанной вместе с хешем; `tokenVersion` растёт, поэтому все прежние токены (включая текущий) получают 401, а новый берётся из ответа. Параллельная смена → 409 у проигравшего. Аватар: `PUT /profile/avatar` (multipart, один файл в поле `file`, JPEG/PNG/WebP до 5 МБ — `AVATAR_MAX_BYTES`; формат определяется по сигнатуре файла в `avatar.ts` (`detectAvatarMimeType`), а не по MIME/расширению клиента: SVG и подмена → 415, больше лимита → 413, нет файла → 400; ответ — `PublicUser`), `GET /profile/avatar` (поток с диска, `Content-Type` из БД, `X-Content-Type-Options: nosniff`, только свой аватар; нет аватара → 404; успешный ответ с `Cache-Control: private, max-age=31536000, immutable` — URL содержит `avatarVersion`, заголовок ставится в контроллере после успеха, а не `@Header`, чтобы не попадал на 404/401), `DELETE /profile/avatar` (204; нет аватара → 404). Файлы лежат в `<UPLOADS_DIR>/avatars/<uuid>` (отдельно от каталогов встреч, sweep `orphan-files.ts` их не трогает), тело читает `receiveSingleFile` из `files` с `drainOnFailure: true`: при отказе (неверный формат, лимит) остаток тела дочитывается (не больше лимита, до 10 с), а не обрывается соединением, иначе медленный клиент или прокси получил бы `EPIPE`/`ECONNRESET` вместо ответа с причиной. Команда `UploadAvatarCommand`, как и загрузка файла встречи, несёт сырой `IncomingMessage` (осознанное исключение из правила «команда = данные»). Загрузка: записать новый файл → обновить БД (`avatarStorageName`, `avatarMimeType`, `avatarUpdatedAt`) → удалить старый; при ошибке новый файл удаляется, запись остаётся прежней. Если ошибка пришла от команды БД, handler перечитывает пользователя (`FindUserByIdQuery`): когда там уже новый файл (обрыв соединения после COMMIT), он остаётся и запрос успешен, когда БД недоступна — файл тоже остаётся и ждёт очистки осиротевших. `orphan-avatars.ts` + `OrphanAvatarsCleaner` (при старте и каждые 10 минут) удаляют файлы из `avatars`, на которые не ссылается ни один пользователь, но только старше часа (`AVATAR_ORPHAN_MIN_AGE_MS`): файл пишется раньше записи в БД, и свежий может быть ещё идущей загрузкой. Общий `removeAvatarFile` из `avatar.ts` удаляет файл (нет файла — не ошибка, прочие сбои логируются с именем). Удаление: сначала очистка записи в БД, затем файл. Записи в `User` — через команды `users`. Handlers: `commands/UploadAvatar*`, `DeleteAvatar*`, `queries/GetAvatar*`.
- `src/rate-limit` — глобальный `RateLimitModule` на `@nestjs/throttler`: два троттлера, `ip` (по `req.ip`) и `account` (по email из тела, иначе по `userId` из токена, иначе по IP). Глобального гарда нет: `@UseGuards(ThrottlerGuard)` повешен только на `POST /auth/register`, `POST /auth/login` и `PUT /profile/password` (превышение → 429; на смене пароля гард стоит после `JwtAuthGuard`, поэтому `userId` уже известен). Счётчик на каждый эндпоинт свой, хранилище в памяти процесса. Параметры — env `AUTH_RATE_LIMIT`, `AUTH_RATE_LIMIT_TTL_MS`. `src/trust-proxy.ts` разбирает `TRUST_PROXY` для express `trust proxy` (`main.ts`); `true` запрещён. Ограничения: BFF в `apps/web` пока не передаёт IP клиента в `X-Forwarded-For`, поэтому при запросах через web API видит один адрес сервера Next и лимит `ip` общий для всех (по email и userId лимит работает как задумано); перед включением `TRUST_PROXY` BFF должен выставлять заголовок. Лимит по email можно исчерпать чужими неудачными попытками (временная блокировка входа на окно).
- `src/prisma` — глобальный `PrismaModule`/`PrismaService`.

Новая операция = класс команды/запроса + handler, зарегистрированный в `providers` модуля.

- `prisma/schema.prisma`, `prisma/migrations`, `prisma.config.ts` — Prisma 7. Клиент генерируется в `src/generated/prisma` (не править, в git не входит); `prisma:generate`, `prisma:migrate`, `prisma:deploy`.
- Env: `JWT_SECRET` (обязателен, не короче 32 байт и не `change-me`, иначе API не стартует; `openssl rand -base64 48`), `JWT_EXPIRES_IN` (`1h`; секунды или число с суффиксом `s|m|h|d`, не больше 24 ч, иначе API не стартует; проверка — `resolveJwtConfig` в `auth/jwt-config.ts`), `AUTH_RATE_LIMIT` (10 запросов за окно), `AUTH_RATE_LIMIT_TTL_MS` (60000), `TRUST_PROXY` (по умолчанию выключен), `DATABASE_URL` (по умолчанию локальный docker-compose), `UPLOADS_DIR` (каталог хранения файлов встреч и аватаров (`avatars/`); относительный путь считается от `apps/api`, а не от cwd; по умолчанию `uploads`, в git не попадает), `MAX_UPLOAD_BYTES` (максимальный размер одного файла в байтах, по умолчанию 500 МиБ, потолок — 2 147 483 647 из-за `Int` в БД).
- `dist/` — артефакты сборки, не править.

## CQRS

Бизнес-логика модулей `auth`, `users`, `meetings`, `files` и `profile` построена на `@nestjs/cqrs`. Разделение только на уровне кода: отдельных моделей чтения/записи, событий и event bus нет.

**Правила**

- Контроллер не содержит логики: берёт данные из запроса и отправляет сообщение в `CommandBus` (запись) или `QueryBus` (чтение), результат возвращает как есть.
- **Команда** меняет состояние: `extends Command<TResult>`, handler с `@CommandHandler(XCommand)` реализует `ICommandHandler`.
- **Запрос** только читает: `extends Query<TResult>`, handler с `@QueryHandler(XQuery)` реализует `IQueryHandler`.
- Команда/запрос — неизменяемый класс с `public readonly` полями в конструкторе. Данные текущего пользователя (`userId`/`ownerId`) контроллер берёт из `AuthenticatedRequest` и передаёт явным полем.
- Handler возвращает публичную модель (`PublicUser`, `PublicMeeting`), а не сущность Prisma (исключение — внутренние сообщения `users`, которые нужны `auth` и `profile` вместе с `passwordHash`). Ошибки — HTTP-исключения Nest (`NotFoundException`, `ConflictException` и т. д.).
- Модуль импортирует `CqrsModule`; handlers обязательно перечисляются в `providers`, иначе шина их не найдёт.
- Доступ к данным — через `PrismaService` напрямую (`meetings`, `users`), а данные других модулей — через их команды/запросы по `CommandBus`/`QueryBus` (`auth` → `users`, `profile` → `users`, `files` → `meetings`). Таблицу `User` пишет только `users`. Если логика разрастается, выносите её в сервис, а не в контроллер.

**Раскладка файлов модуля**

```
src/<module>/
  commands/<action>.command.ts   # класс команды
  commands/<action>.handler.ts   # handler команды
  queries/<action>.query.ts      # класс запроса
  queries/<action>.handler.ts    # handler запроса
  <module>.controller.ts         # только CommandBus/QueryBus
  <module>.module.ts             # CqrsModule + handlers в providers
```

**Новая операция**: класс команды/запроса → handler → регистрация в `providers` модуля → метод контроллера → e2e-тест в `test/`.

**Пример** (`meetings`): `GET /meetings/:id` → `MeetingsController.get` → `QueryBus.execute(new GetMeetingQuery(req.userId, id))` → `GetMeetingHandler` ищет встречу по `id` и `ownerId` и бросает `NotFoundException`, если её нет.

## Тесты

- Vitest (не Jest), `globals: true`, алиасы путей из `tsconfig.json` (`resolve.tsconfigPaths`).
- Unit-тесты: `src/**/*.spec.ts` рядом с исходниками.
- E2E: `test/*.e2e-spec.ts` на `supertest` (файлы загрузок пишутся в `apps/api/uploads-e2e`, он в `.gitignore`), отдельный конфиг `vitest.config.e2e.ts` (задаёт `JWT_SECRET` и высокий `AUTH_RATE_LIMIT`; `rate-limit.e2e-spec.ts` ставит свой низкий лимит до создания приложения). Требуют запущенный Postgres (`docker compose up -d --wait`) и применённые миграции.

**Запуск**

| Что                   | Команда                                                                                                   | Нужна БД        |
| --------------------- | --------------------------------------------------------------------------------------------------------- | --------------- |
| Unit                  | `pnpm --filter api test` (из корня) или `pnpm test` (из `apps/api`)                                       | нет             |
| Unit в watch-режиме   | `pnpm --filter api test:watch`                                                                            | нет             |
| Покрытие              | `pnpm --filter api test:cov`                                                                              | нет             |
| E2E «одной командой»  | `pnpm test:e2e` из корня: поднимет Postgres, применит миграции, запустит e2e                              | да (сам)        |
| E2E вручную           | `docker compose up -d --wait`, `pnpm --filter api prisma:deploy`, `pnpm --filter api test:e2e`            | да              |
| Один файл / один тест | `pnpm --filter api test src/users/user.spec.ts`, `... test:e2e test/auth.e2e-spec.ts -t "часть названия"` | зависит от типа |
| Отладка               | `pnpm --filter api test:debug` (inspector, без параллелизма)                                              | нет             |

- Unit-тесты не ходят в БД: Prisma мокается (`prisma as never`), handlers создаются вручную через `new`.
- E2E поднимают `AppModule` целиком и пишут в реальную БД; данные не чистятся, поэтому каждый тест использует уникальный email (`randomUUID()`).
- `pnpm test` из корня запускает только unit; e2e всегда отдельной командой.
- Перед e2e должен быть сгенерирован клиент Prisma (`pnpm install` или `pnpm --filter api prisma:generate`).

## Документация

При изменении архитектуры `apps/api` (модули, структура `src`, стек, зависимости, команды, конфиги, порты, env-переменные) обновляйте этот файл и корневой `CLAUDE.md` в том же изменении; убирайте устаревшие утверждения.
