# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`video-meetings` is a pnpm monorepo (pnpm 10, Node >= 22) with two apps under `apps/*` and shared packages under `packages/*`:

- `apps/web` — Next.js 16 (App Router, `src/app`), React 19. `next.config.ts` enables `cacheComponents` and `partialPrefetching`. Path alias `@/*` → `src/*`.
- `apps/api` — NestJS 12 backend, **native ESM** (`"type": "module"`, `module: nodenext`). Relative imports must include the `.js` extension (e.g. `import { AppModule } from './app.module.js'`); `main.ts` uses top-level `await`.
- `packages/llm-sdk` (`@video-meetings/llm-sdk`) — локальная реализация публичного интерфейса `@anthropic-ai/claude-agent-sdk` поверх Ollama (Qwen3 в LAN). ESM, `tsc` в `dist`. Типы `SDKMessage`/`Query`/`Options` повторяют оригинал; опорная версия оригинала — его `devDependencies` (сейчас `0.3.322`). Умеет `query()` (`model`, `systemPrompt`) с агентным циклом по SDK-инструментам: `tool()` + `createSdkMcpServer()` (zod 4, в `mcpServers`), `maxTurns`, права (`allowedTools`, `disallowedTools`, `canUseTool`, `permissionMode`), хуки (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SessionStart`, `SessionEnd`) и контроль размера контекста по `num_ctx` (старые результаты инструментов усекаются, самые старые обмены схлопываются, ответ ограничен `num_predict`; не помещается — `result/error_during_execution`, а не молчаливая обрезка). Подробности — `packages/llm-sdk/README.md`.
- `packages/llm` (`@video-meetings/llm`) — фасад: по `LLM_PROVIDER` (`local` по умолчанию | `anthropic`) реэкспортирует `query` и типы из `llm-sdk` или `@anthropic-ai/claude-agent-sdk`. **Код фич импортирует только фасад.** В режиме `local` модуль Anthropic не загружается. `test/compat/feature.ts` компилируется с обеими реализациями (`typecheck:compat`, входит в `test`); контрактный набор против живой модели — вручную (`packages/llm/README.md`).

Пакеты экспортируют `dist` и условие `source` → `src/index.ts`: тесты и линт работают без сборки (`customConditions` в `tsconfig.json`, alias в `vitest.config.ts`), `pnpm build` собирает их по порядку зависимостей. В `apps/*` пакеты пока не подключены.

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

Per-app commands via `pnpm --filter <web|api|@video-meetings/llm-sdk|@video-meetings/llm> <script>`:

- web: `typecheck` (`next typegen && tsc --noEmit`), `test:watch`
- api: `test:e2e` (separate config `vitest.config.e2e.ts`, picks up `test/**/*.e2e-spec.ts`), `test:cov`, `test:debug`, `start:debug`
- llm-sdk, llm: `build`, `lint`, `test`, `typecheck`; llm ещё `typecheck:compat` и `test:contract` (живая модель, только вручную: `LLM_CONTRACT=1 pnpm --filter @video-meetings/llm test:contract`)

Single test file / single test name (Vitest in both apps):

```bash
pnpm --filter api test src/users/user.spec.ts
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

Модули `auth` (`POST /auth/register`, `POST /auth/login`, `POST /auth/logout` — отзывает все токены пользователя, `GET /auth/me`) и `users` (без HTTP-эндпоинтов; `auth` обращается к нему командами/запросами через шины). Бизнес-логика построена по паттерну CQRS (`@nestjs/cqrs`): контроллер отправляет команды/запросы в `CommandBus`/`QueryBus`, логика — в handlers (`apps/api/src/auth/commands`, `queries`). Правила и раскладка файлов — в разделе «CQRS» файла `apps/api/CLAUDE.md`. JWT (HS256, `@nestjs/jwt`) в `Authorization: Bearer`; пароли хешируются `scrypt` (`node:crypto`, N=2^17, параметры хранятся в хеше, старые хеши обновляются при входе). Env: `JWT_SECRET` (обязателен, ≥ 32 байт, не `change-me`, иначе API не стартует), `JWT_EXPIRES_IN` (по умолчанию `1h`, максимум 24 ч, кривое значение — ошибка старта), `AUTH_RATE_LIMIT`/`AUTH_RATE_LIMIT_TTL_MS` (лимит на `/auth/login`, `/auth/register`, `PUT /profile/password`: по IP, на входе — по неудачным попыткам пары email+IP и нарастающая блокировка по email, иначе 429 с `Retry-After`; по умолчанию 10 в минуту), `TRUST_PROXY` (число прокси перед API; web передаёт API IP клиента в `X-Forwarded-For`, поэтому за BFF ставьте 1 и закройте API от прямого доступа; по умолчанию заголовок не доверяем), `TRUSTED_PROXIES` (web: число обратных прокси перед Next, по ним берётся IP клиента; по умолчанию 0 — IP не передаётся), `SCRYPT_CONCURRENCY`/`SCRYPT_QUEUE_LIMIT` (одновременные scrypt, по умолчанию 2 и 32, переполнение — 503), `SWAGGER_ENABLED` (Swagger выключен, пока не `true`, в production не включается), `DATABASE_URL`, `UPLOADS_DIR` (каталог файлов встреч и аватаров), `MAX_UPLOAD_BYTES` (лимит одного файла, по умолчанию 500 МиБ). Модуль `meetings` (`POST /meetings`, `GET /meetings`, `GET /meetings/:id`, только для авторизованных; пользователь видит лишь свои встречи) устроен так же; модуль `files` (`POST/GET /meetings/:id/files`, `GET …/files/:fileId/download`, `DELETE …/files/:fileId`, загрузка потоком через `busboy` на диск в `UPLOADS_DIR`; `DELETE /meetings/:id` удаляет встречу вместе с файлами) — тоже; модуль `profile` (`PATCH /profile` — изменение своего имени, `{ name }`: не длиннее 100 символов, без управляющих символов, с буквой или цифрой, иначе 400; запись в `User` идёт через команду модуля `users`; читать профиль — `GET /auth/me`; смена пароля — `PUT /profile/password` (`{ currentPassword, newPassword }`, неверный текущий → 403, успех → новый токен как при логине; `User.tokenVersion` растёт, и `JwtAuthGuard` отвечает 401 на все прежние токены, сверяя версию из JWT с БД на каждом запросе); аватар — `PUT/GET/DELETE /profile/avatar`: JPEG/PNG/WebP до 5 МБ, формат по сигнатуре файла, файлы в `UPLOADS_DIR/avatars`) — тоже. Валидация — глобальный `ValidationPipe` через `APP_PIPE` в `AppModule`. Документация API (Swagger/OpenAPI): `http://localhost:3001/docs`, JSON — `/docs-json` (`apps/api/src/swagger.ts`); при `NODE_ENV=production` отключена. API отдаёт защитные заголовки `helmet` и без `X-Powered-By` (`apps/api/src/security.ts`).

## LLM

Env фасада и локального SDK (см. `.env.example`): `LLM_PROVIDER` (`local` | `anthropic`, по умолчанию `local`, другое значение — ошибка при импорте фасада), `OLLAMA_URL` (по умолчанию `http://localhost:11434`), `OLLAMA_MODEL` (`qwen3:14b`), `OLLAMA_NUM_CTX` (`32768`; Ollama молча режет вход сверх него), `OLLAMA_TIMEOUT_MS` (таймаут запроса, `300000`), `ANTHROPIC_API_KEY` (только для `anthropic`). Недоступная Ollama, таймаут и HTTP-ошибка — исключение из генератора с понятным текстом. Unit-тесты пакетов идут на мок-`fetch`, сеть и Ollama не нужны.

## Testing setup

- Both apps use **Vitest** (not Jest) with `globals: true` — `describe`/`it`/`expect` are available without imports.
- web: jsdom environment, `@testing-library/react`, jest-dom matchers loaded in `vitest.setup.ts`; tests are `src/**/*.{test,spec}.{ts,tsx}`, colocated with the code.
- api: unit tests are `*.spec.ts` next to sources; e2e tests are `test/*.e2e-spec.ts` using `supertest`.
- packages: `src/**/*.spec.ts` (node, `unstubEnvs`/`unstubGlobals`); контрактные `packages/llm/test/contract/*.contract.ts` в `pnpm test` не входят.
- Unit: `pnpm test` (root, all apps) — no database needed. api e2e: `pnpm test:e2e` (root) starts Postgres, applies migrations and runs them. Full run table and per-file examples: `apps/api/CLAUDE.md`, section «Тесты».

## Gotchas

- Web слушает порт 3000, API — 3001 (`process.env.PORT ?? 3001` в `apps/api/src/main.ts`). `pnpm dev` запускает оба; web проксирует `/api/*` на API (`API_URL`) через route handlers (потоково, в том числе загрузка и скачивание файлов до 500 МиБ); JWT хранится в HttpOnly-cookie на стороне Next; API читает корневой `.env` (`cp .env.example .env`), `JWT_SECRET` в `.env.example` пустой и обязателен: впишите результат `openssl rand -base64 48`, иначе API не стартует.
- `pnpm-workspace.yaml` whitelists dependency build scripts (`onlyBuiltDependencies`); new packages that need postinstall scripts must be added there.

## Code style

Prettier (root `.prettierrc`): single quotes, trailing commas, no semicolons, `printWidth: 100`. 2-space indent, LF. ESLint in each app extends `eslint-config-prettier`, so formatting is Prettier's job only.

## UI library

`apps/web` uses **HeroUI v3** (`@heroui/react`, `@heroui/styles`) on Tailwind CSS v4 (PostCSS via `@tailwindcss/postcss`). Styles are wired in `apps/web/src/app/globals.css`; no provider is needed. Use the `heroui-react` skill (pinned in `skills-lock.json`) and fetch component docs before building UI.

## Keeping docs up to date

When a change alters the architecture — new/removed apps or shared packages, module or directory structure, tech stack or major dependencies, build/test/dev commands, ports, env vars, or conventions — update the affected documentation **in the same change**: this root `CLAUDE.md`, the `CLAUDE.md` of each touched app (`apps/*/CLAUDE.md`), and any README. Remove statements that are no longer true (e.g. "no shared package yet").

## Git hooks (Husky)

`.husky/pre-commit` запускает `pnpm lint` и `pnpm test` (unit, без БД) перед каждым коммитом; при ошибке коммит блокируется. Хуки ставятся автоматически при `pnpm install` (скрипт `prepare`: `husky`, он же выставляет `core.hooksPath`). e2e в хук не входят — они требуют Postgres, запускайте `pnpm test:e2e` вручную. Обход в крайнем случае — `git commit --no-verify`.

## Правила работы Claude

- **Коммиты на русском:** summary и body сообщений коммитов пишутся по-русски; префикс Conventional Commits (`feat`, `fix`, `chore`…) и trailer `Co-Authored-By` остаются как есть.
- **Dev-серверы не запускать:** разработчик держит `pnpm dev` у себя. Запуск вторым экземпляром конфликтует по портам 3000/3001, а `pkill` по `next`/`nest`/`pnpm` убивает его серверы. Для проверки в браузере сначала посмотреть, что слушает порт (`lsof -iTCP:3000 -sTCP:LISTEN`); если сервера нет — попросить запустить.
- **Артефакты Playwright чистить:** после работы с Playwright MCP удалять из `.playwright-mcp/` скриншоты (`*.png`), логи консоли (`console-*.log`) и снимки страниц (`page-*.yml`). Папка в `.gitignore`, коммитить её не нужно.

## Hooks

`.claude/settings.json` defines a `PostToolUse` hook (`Write|Edit`) that runs `prettier --write` on every file Claude changes; files matched by `.prettierignore` or unsupported by Prettier are skipped. No manual formatting is needed after edits.

The `Stop` hook (`.claude/hooks/stop.js`) is the Ralph loop: it picks up open issues of the milestone from `.claude/ralph.config.json`, runs `claude -p` with the rules from `.claude/ralph.md`, and opens a PR when the milestone is done. It is inert unless `RALPH_ACTIVE=1` is set, so ordinary sessions are not affected. Start the loop with `node .claude/ralph.start.js` (it sets the variable itself); to run only the hook use `RALPH_ACTIVE=1 node .claude/hooks/stop.js`. Claude Code does not show the hook's output in the terminal, so the hook (and the nested `claude -p` sessions, including the final Opus review) logs to `.claude/ralph.log` (git-ignored): follow it with `tail -f .claude/ralph.log`. A nested session that fails (usually by hitting `maxTurns`) does not fire its own `Stop` hook, so the parent hook (or `ralph.start.js` for the first iteration) logs the failure and starts the next iteration itself; the agent then continues the unfinished work in the branch (rule in `ralph.md`), and two failures in a row stop the loop. The hook has `timeout: 3600` in `settings.json`, otherwise a long nested session or the review would be killed. There is no on/off flag in the config on purpose: the file is tracked by git, and a local edit of it conflicts with updates from `main`. Per phase, change `milestone` and `branch` in the config in a separate PR.
