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
- `src/app.module.ts` — корневой модуль: подключает `PrismaModule`, `UsersModule`, `AuthModule`, `MeetingsModule`, `FilesModule` и глобальный `ValidationPipe` (`APP_PIPE`, `whitelist` + `transform`). Корневого контроллера/сервиса нет (`GET /` → 404); новые фичи оформлять отдельными Nest-модулями (`nest g module`) и подключать в `AppModule`.
- `src/swagger.ts` — `setupSwagger(app)`: OpenAPI на `@nestjs/swagger` (UI `GET /docs`, JSON `GET /docs-json`, Bearer-авторизация). Вызывается в `main.ts`. Схемы DTO строит плагин Nest CLI из `nest-cli.json` (`esmCompatible`, файлы `dto.ts`), поэтому `@ApiProperty` в DTO не нужен; контроллеры помечать `@ApiTags(...)`, защищённые маршруты — `@ApiBearerAuth()`. Плагин работает только при `nest build`/`dev`; в vitest схемы полей DTO не генерируются.

**Модули**

- `src/auth` (CQRS) — `POST /auth/register`, `POST /auth/login`, `GET /auth/me`. `commands/` (`RegisterUser*`, `LoginUser*`), `queries/` (`GetCurrentUser*`), `TokenService` (выпуск JWT), `AuthController` (только `CommandBus`/`QueryBus`), `JwtAuthGuard`, `dto.ts`, `password.ts` (scrypt). Данные пользователей берёт у `users` через шины. Экспортирует `JwtModule` и `JwtAuthGuard` для других модулей.
- `src/users` (CQRS, без контроллера, только для `auth`) — `commands/CreateUser*`, `queries/FindUserByEmail*`, `FindUserById*`. Возвращают сущность Prisma `User` с `passwordHash` — это внутренние сообщения, наружу их не отдавать. `user.ts` — `PublicUser`, `toPublicUser`.
- `src/meetings` (CQRS) — `POST /meetings`, `GET /meetings`, `GET /meetings/:id`, всё под `JwtAuthGuard`; встречи видны только владельцу, чужая/несуществующая = 404. `commands/CreateMeeting*`, `queries/ListMeetings*`, `GetMeeting*`, модель Prisma `Meeting` (`participants` — `String[]`).
- `src/files` (CQRS) — файлы встреч: `POST /meetings/:meetingId/files` (multipart, один файл за запрос в поле `file`), `GET /meetings/:meetingId/files` (только файлы со статусом `uploaded`); под `JwtAuthGuard`, доступ только владельцу встречи: handlers проверяют его через `QueryBus` запросом `GetMeetingQuery` из `meetings` (чужая/несуществующая = 404). Загрузка: `commands/UploadMeetingFile*` проверяет владельца до чтения тела (поэтому команда несёт сырой `IncomingMessage` — осознанное исключение из правила «команда = данные»), затем `multipart.ts` (`receiveSingleFile`) парсит поток напрямую через `busboy` (`defParamCharset: 'utf8'`, не Multer) с лимитами: размер (`MAX_UPLOAD_BYTES` → 413, в том числе заранее по `Content-Length`), один файл, поле строго `file`, без текстовых полей; обрыв соединения и битое тело прерывают запись. Handler создаёт запись `MeetingFile` со статусом `uploading` и стримит файл на диск под `<UPLOADS_DIR>/<meetingId>/<uuid>` (исходное имя и `Content-Type` проходят через `sanitize.ts`: имя ≤ 255 символов без управляющих, MIME только корректный `type/subtype`, иначе `application/octet-stream`); при успехе статус `uploaded` и фактический размер, при любой ошибке `discard-file.ts` удаляет файл и ставит `failed` (сбои очистки логируются). `stale-uploads.cleaner.ts` при старте и затем каждые 10 минут закрывает записи, зависшие в `uploading` дольше 3 часов (упавший процесс; запас нужен для медленных загрузок). Серверный `requestTimeout` Node отключён в `main.ts` (`0`), иначе загрузка 500 МиБ на медленном канале обрывалась бы через 5 минут. `storage.ts` — пути и лимит.
- `src/prisma` — глобальный `PrismaModule`/`PrismaService`.

Новая операция = класс команды/запроса + handler, зарегистрированный в `providers` модуля.

- `prisma/schema.prisma`, `prisma/migrations`, `prisma.config.ts` — Prisma 7. Клиент генерируется в `src/generated/prisma` (не править, в git не входит); `prisma:generate`, `prisma:migrate`, `prisma:deploy`.
- Env: `JWT_SECRET` (обязателен), `JWT_EXPIRES_IN` (`1h`), `DATABASE_URL` (по умолчанию локальный docker-compose), `UPLOADS_DIR` (каталог хранения файлов встреч; относительный путь считается от `apps/api`, а не от cwd; по умолчанию `uploads`, в git не попадает), `MAX_UPLOAD_BYTES` (максимальный размер одного файла в байтах, по умолчанию 500 МиБ, потолок — 2 147 483 647 из-за `Int` в БД).
- `dist/` — артефакты сборки, не править.

## CQRS

Бизнес-логика модулей `auth`, `users`, `meetings` и `files` построена на `@nestjs/cqrs`. Разделение только на уровне кода: отдельных моделей чтения/записи, событий и event bus нет.

**Правила**

- Контроллер не содержит логики: берёт данные из запроса и отправляет сообщение в `CommandBus` (запись) или `QueryBus` (чтение), результат возвращает как есть.
- **Команда** меняет состояние: `extends Command<TResult>`, handler с `@CommandHandler(XCommand)` реализует `ICommandHandler`.
- **Запрос** только читает: `extends Query<TResult>`, handler с `@QueryHandler(XQuery)` реализует `IQueryHandler`.
- Команда/запрос — неизменяемый класс с `public readonly` полями в конструкторе. Данные текущего пользователя (`userId`/`ownerId`) контроллер берёт из `AuthenticatedRequest` и передаёт явным полем.
- Handler возвращает публичную модель (`PublicUser`, `PublicMeeting`), а не сущность Prisma (исключение — внутренние сообщения `users`, которые нужны `auth` вместе с `passwordHash`). Ошибки — HTTP-исключения Nest (`NotFoundException`, `ConflictException` и т. д.).
- Модуль импортирует `CqrsModule`; handlers обязательно перечисляются в `providers`, иначе шина их не найдёт.
- Доступ к данным — через `PrismaService` напрямую (`meetings`, `users`), а данные других модулей — через их команды/запросы по `CommandBus`/`QueryBus` (`auth` → `users`). Если логика разрастается, выносите её в сервис, а не в контроллер.

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
- E2E: `test/*.e2e-spec.ts` на `supertest` (файлы загрузок пишутся в `apps/api/uploads-e2e`, он в `.gitignore`), отдельный конфиг `vitest.config.e2e.ts` (задаёт `JWT_SECRET`). Требуют запущенный Postgres (`docker compose up -d --wait`) и применённые миграции.

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
