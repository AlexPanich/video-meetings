# CLAUDE.md — apps/web

Фронтенд `video-meetings`: Next.js 16 (App Router), React 19, TypeScript. Общие правила репозитория — в корневом `CLAUDE.md`.

## Команды

Запускать из корня через `pnpm --filter web <script>` или из этой папки через `pnpm <script>`:

- `dev` / `build` / `start` — Next.js
- `lint` — ESLint (`eslint-config-next` + `eslint-config-prettier`)
- `typecheck` — `next typegen && tsc --noEmit`
- `test` — `vitest run`; `test:watch` — watch-режим

Один тест: `pnpm --filter web test src/app/page.test.tsx -t "renders main heading"`.

## Next.js 16

Версия с breaking changes: API, конвенции и структура файлов могут отличаться от привычных. Перед написанием кода читайте нужный гайд в `apps/web/node_modules/next/dist/docs/` и учитывайте deprecation-предупреждения. `next dev` сам создаёт `AGENTS.md` с этим правилом — это отключено через `agentRules: false` в `next.config.ts`.

## Структура

- `src/app/page.tsx` — главная (только для авторизованных: гость без cookie редиректится на `/login` в `src/proxy.ts` до рендера; внутри `<Suspense>` серверный `UserGreeting` через `getCurrentUser()` (`src/lib/server/auth.ts`, cookie → `GET /auth/me`) получает пользователя и при отказе API делает `redirect('/login')`; `MeetingsOverview` (счётчик встреч, последние 3, кнопка «Создать встречу» — пока заглушка без действия; данные из `getMeetings()` в `src/lib/server/meetings.ts`); `LogoutButton` — клиентский; оболочка страницы статична, данные пользователя динамические); `src/app/meetings/[id]` — страница встречи (только для авторизованных; `params` читается внутри `<Suspense>` в серверном `MeetingDetails`: данные встречи через `getMeeting()`, нет токена → `/login`, нет/чужая встреча → `notFound()`; ниже клиентский блок `MeetingFiles` со списком файлов: имя, размер, дата, статус и состояния загрузки/пусто/ошибка с повтором; форматирование — `src/lib/format.ts`); `src/app/(auth)/login`, `register` — страницы входа и регистрации (`AuthShell` + `LoginForm`/`RegisterForm` из `src/components`).
- `src/lib/api.ts` — клиент API (`login`, `register`, `getMe`, `getMeetingFiles`, `ApiError`, `logout`). Запросы идут на `/api/*` — это route handlers Next (BFF), CORS не нужен: `src/app/api/auth/{login,register,logout}` ставят/сбрасывают HttpOnly-cookie `access-token` (JWT от API в браузер не попадает, клиенту отдаётся только `user`), а `src/app/api/[...path]` проксирует остальное на бэкенд (`API_URL`, по умолчанию `http://localhost:3001`), подставляя `Authorization: Bearer` из cookie и сбрасывая cookie при 401. Прокси потоковый: тело запроса идёт в API как `request.body` с `duplex: 'half'` (без `arrayBuffer()`), `Content-Length` пробрасывается (API отсекает слишком большой файл заранее), из ответа передаются `Content-Type`, `Content-Disposition`, `Content-Length`, `X-Content-Type-Options` — без них скачанный файл потерял бы имя и открывался бы inline. Через него идут файловые эндпоинты (`/api/meetings/:id/files…`: загрузка, список, скачивание, удаление). `src/proxy.ts` закрывает `/` и `/meetings/*`, но **не** `/api/*`: иначе Next буферизует тело запроса и загрузка больших файлов ломается. Серверные хелперы — `src/lib/server/auth.ts`.
- `src/app` — маршруты App Router (`layout.tsx`, `page.tsx`, `globals.css` с Tailwind и HeroUI).
- Алиас путей `@/*` → `src/*`.
- `next.config.ts` (rewrites больше нет) включает `cacheComponents` и `partialPrefetching` — учитывать при работе с кэшированием и динамическими данными в Server Components.

## Тесты

- Vitest, окружение jsdom, `globals: true` (`describe`/`it`/`expect` без импортов).
- `@testing-library/react`; jest-dom-матчеры подключены в `vitest.setup.ts`.
- Тесты лежат рядом с кодом: `src/**/*.{test,spec}.{ts,tsx}`.

## UI

HeroUI v3 (`@heroui/react`, `@heroui/styles`) на Tailwind CSS v4. Провайдер не нужен; стили подключены в `src/app/globals.css` (`@import 'tailwindcss'` → `@import '@heroui/styles'`, порядок важен), PostCSS — `postcss.config.mjs`. Компоненты составные (`Card.Header`), обработчики — `onPress`, не `onClick`. Перед добавлением компонентов сверяйтесь со скиллом `heroui-react` и документацией (`https://heroui.com/docs/react/components/<name>.mdx`).

## Особенности

- Dev-сервер на порту 3000; API слушает 3001, конфликта нет.
- `.next`, `next-env.d.ts` и `tsconfig.tsbuildinfo` — генерируемые файлы, не править вручную.

## Документация

При изменении архитектуры `apps/web` (структура `src`, маршруты, стек, зависимости, команды, конфиги) обновляйте этот файл и корневой `CLAUDE.md` в том же изменении; убирайте устаревшие утверждения.
