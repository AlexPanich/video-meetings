# CLAUDE.md — apps/api

Бэкенд `video-meetings`: NestJS 12 на Express, нативный ESM (`"type": "module"`, `module: nodenext`). Общие правила репозитория — в корневом `CLAUDE.md`.

## Команды

Запускать из корня через `pnpm --filter api <script>` или из этой папки через `pnpm <script>`:

- `build` — `nest build` (результат в `dist/`); `start:prod` — `node dist/main`
- `dev` — watch-режим с загрузкой корневого `.env` (его же запускает `pnpm dev` из корня); `start:dev` — алиас на `dev`; `start:debug` — watch + inspector
- `lint` — ESLint по `src` и `test`
- `test` — `vitest run` (unit); `test:watch`; `test:cov`; `test:debug`
- `test:e2e` — `vitest run --config ./vitest.config.e2e.ts`

Один тест: `pnpm --filter api test src/app.controller.spec.ts`.

## ESM

- Относительные импорты **обязательно с расширением `.js`**: `import { AppModule } from './app.module.js'` (даже для `.ts`-файлов).
- `src/main.ts` использует top-level `await`.
- Не использовать `require`/`__dirname`; для путей — `import.meta.url`.

## Структура

- `src/main.ts` — bootstrap, порт `process.env.PORT ?? 3001` (web занимает 3000).
- `src/app.module.ts`, `app.controller.ts`, `app.service.ts` — корневой модуль; новые фичи оформлять отдельными Nest-модулями (`nest g module|controller|service`).
- `src/auth` — регистрация/логин/JWT на **CQRS** (`@nestjs/cqrs`): `commands/` (`RegisterUserCommand`, `LoginUserCommand` + handlers), `queries/` (`GetCurrentUserQuery` + handler), `TokenService` (выпуск JWT), `AuthController` (только `CommandBus`/`QueryBus`), `JwtAuthGuard`, DTO, `password.ts` на scrypt. Новая операция = класс команды/запроса + handler, зарегистрированный в `providers` модуля; `src/meetings` — встречи (CQRS): `POST /meetings`, `GET /meetings`, `GET /meetings/:id` (всё под `JwtAuthGuard`, встречи видны только владельцу, чужая/несуществующая = 404), `commands/CreateMeeting*`, `queries/ListMeetings*`, `GetMeeting*`, модель Prisma `Meeting` (`participants` — `String[]`); `AuthModule` экспортирует `JwtModule` и `JwtAuthGuard` для других модулей; `src/users` — `UsersService`; `src/prisma` — глобальный `PrismaService`.
- `prisma/schema.prisma`, `prisma/migrations`, `prisma.config.ts` — Prisma 7. Клиент генерируется в `src/generated/prisma` (не править, в git не входит); `prisma:generate`, `prisma:migrate`, `prisma:deploy`.
- Env: `JWT_SECRET` (обязателен), `JWT_EXPIRES_IN` (`1h`), `DATABASE_URL` (по умолчанию локальный docker-compose).
- `dist/` — артефакты сборки, не править.

## CQRS

Бизнес-логика модулей `auth` и `meetings` построена на `@nestjs/cqrs`. Разделение только на уровне кода: отдельных моделей чтения/записи, событий и event bus нет.

**Правила**

- Контроллер не содержит логики: берёт данные из запроса и отправляет сообщение в `CommandBus` (запись) или `QueryBus` (чтение), результат возвращает как есть.
- **Команда** меняет состояние: `extends Command<TResult>`, handler с `@CommandHandler(XCommand)` реализует `ICommandHandler`.
- **Запрос** только читает: `extends Query<TResult>`, handler с `@QueryHandler(XQuery)` реализует `IQueryHandler`.
- Команда/запрос — неизменяемый класс с `public readonly` полями в конструкторе. Данные текущего пользователя (`userId`/`ownerId`) контроллер берёт из `AuthenticatedRequest` и передаёт явным полем.
- Handler возвращает публичную модель (`PublicUser`, `PublicMeeting`), а не сущность Prisma. Ошибки — HTTP-исключения Nest (`NotFoundException`, `ConflictException` и т. д.).
- Модуль импортирует `CqrsModule`; handlers обязательно перечисляются в `providers`, иначе шина их не найдёт.
- Доступ к данным — через `PrismaService` напрямую (`meetings`) или через сервис (`auth` → `UsersService`). Если логика разрастается, выносите её в сервис, а не в контроллер.

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
- E2E: `test/*.e2e-spec.ts` на `supertest`, отдельный конфиг `vitest.config.e2e.ts` (задаёт `JWT_SECRET`). Требуют запущенный Postgres (`docker compose up -d --wait`) и применённые миграции.

## Документация

При изменении архитектуры `apps/api` (модули, структура `src`, стек, зависимости, команды, конфиги, порты, env-переменные) обновляйте этот файл и корневой `CLAUDE.md` в том же изменении; убирайте устаревшие утверждения.
