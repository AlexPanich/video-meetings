# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`video-meetings` is a pnpm monorepo (pnpm 10, Node >= 22) with two apps under `apps/*`:

- `apps/web` — Next.js 16 (App Router, `src/app`), React 19. `next.config.ts` enables `cacheComponents` and `partialPrefetching`. Path alias `@/*` → `src/*`.
- `apps/api` — NestJS 12 backend, **native ESM** (`"type": "module"`, `module: nodenext`). Relative imports must include the `.js` extension (e.g. `import { AppModule } from './app.module.js'`); `main.ts` uses top-level `await`.

Both projects are currently fresh scaffolds — there is no shared package between them yet.

## Commands

Run from the repo root:

```bash
pnpm install
pnpm dev            # all apps in parallel
pnpm dev:web        # Next.js dev server only
pnpm dev:api        # Nest in watch mode only
pnpm build | lint | test   # recursively across apps
pnpm test:e2e       # поднимает Postgres, применяет миграции и запускает e2e api
pnpm format         # prettier --write . (format:check for CI)
```

Per-app commands via `pnpm --filter <web|api> <script>`:

- web: `typecheck` (`next typegen && tsc --noEmit`), `test:watch`
- api: `test:e2e` (separate config `vitest.config.e2e.ts`, picks up `test/**/*.e2e-spec.ts`), `test:cov`, `test:debug`, `start:debug`

Single test file / single test name (Vitest in both apps):

```bash
pnpm --filter api test src/app.controller.spec.ts
pnpm --filter web test src/app/page.test.tsx -t "renders main heading"
```

## База данных

PostgreSQL 17 поднимается через `docker-compose.yml` в корне (сервис `postgres`, данные в volume `postgres-data`):

```bash
docker compose up -d --wait   # запустить и дождаться healthcheck
docker compose down           # остановить (-v — удалить данные)
```

Параметры — через переменные окружения с дефолтами (см. `.env.example`; свой `.env` в git не попадает): `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` (`video_meetings`), `POSTGRES_PORT` (`5432`). Строка подключения по умолчанию: `postgresql://postgres:postgres@localhost:5432/video_meetings`. API использует БД через **Prisma 7** (`@prisma/adapter-pg`): схема `apps/api/prisma/schema.prisma`, миграции `apps/api/prisma/migrations`, конфиг `apps/api/prisma.config.ts`. Клиент генерируется в `apps/api/src/generated/prisma` (в git не попадает; `pnpm install`/`build` запускают `prisma generate`). Миграции: `pnpm --filter api prisma:migrate` (dev), `prisma:deploy` (prod). E2E-тесты ходят в реальную БД — перед `test:e2e` поднимите `docker compose up -d --wait` и примените миграции.

## Аутентификация (API)

Модули `auth` (`POST /auth/register`, `POST /auth/login`, `GET /auth/me`) и `users`. Бизнес-логика построена по паттерну CQRS (`@nestjs/cqrs`): контроллер отправляет команды/запросы в `CommandBus`/`QueryBus`, логика — в handlers (`apps/api/src/auth/commands`, `queries`). Правила и раскладка файлов — в разделе «CQRS» файла `apps/api/CLAUDE.md`. JWT (HS256, `@nestjs/jwt`) в `Authorization: Bearer`; пароли хешируются `scrypt` (`node:crypto`). Env: `JWT_SECRET` (обязателен), `JWT_EXPIRES_IN` (по умолчанию `1h`), `DATABASE_URL`. Модуль `meetings` (`POST /meetings`, `GET /meetings`, `GET /meetings/:id`, только для авторизованных; пользователь видит лишь свои встречи) устроен так же. Валидация — глобальный `ValidationPipe` через `APP_PIPE` в `AppModule`.

## Testing setup

- Both apps use **Vitest** (not Jest) with `globals: true` — `describe`/`it`/`expect` are available without imports.
- web: jsdom environment, `@testing-library/react`, jest-dom matchers loaded in `vitest.setup.ts`; tests are `src/**/*.{test,spec}.{ts,tsx}`, colocated with the code.
- api: unit tests are `*.spec.ts` next to sources; e2e tests are `test/*.e2e-spec.ts` using `supertest`.

## Gotchas

- Web слушает порт 3000, API — 3001 (`process.env.PORT ?? 3001` в `apps/api/src/main.ts`). `pnpm dev` запускает оба; web проксирует `/api/*` на API (`API_URL`) через route handlers; JWT хранится в HttpOnly-cookie на стороне Next; API читает корневой `.env` (`cp .env.example .env`), `JWT_SECRET` обязателен.
- `pnpm-workspace.yaml` whitelists dependency build scripts (`onlyBuiltDependencies`); new packages that need postinstall scripts must be added there.

## Code style

Prettier (root `.prettierrc`): single quotes, trailing commas, no semicolons, `printWidth: 100`. 2-space indent, LF. ESLint in each app extends `eslint-config-prettier`, so formatting is Prettier's job only.

## UI library

`apps/web` uses **HeroUI v3** (`@heroui/react`, `@heroui/styles`) on Tailwind CSS v4 (PostCSS via `@tailwindcss/postcss`). Styles are wired in `apps/web/src/app/globals.css`; no provider is needed. Use the `heroui-react` skill (pinned in `skills-lock.json`) and fetch component docs before building UI.

## Keeping docs up to date

When a change alters the architecture — new/removed apps or shared packages, module or directory structure, tech stack or major dependencies, build/test/dev commands, ports, env vars, or conventions — update the affected documentation **in the same change**: this root `CLAUDE.md`, the `CLAUDE.md` of each touched app (`apps/*/CLAUDE.md`), and any README. Remove statements that are no longer true (e.g. "no shared package yet").

## Hooks

`.claude/settings.json` defines a `PostToolUse` hook (`Write|Edit`) that runs `prettier --write` on every file Claude changes; files matched by `.prettierignore` or unsupported by Prettier are skipped. No manual formatting is needed after edits.
