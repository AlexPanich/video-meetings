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

- `src/app/page.tsx` — главная; `src/app/(auth)/login`, `register` — страницы входа и регистрации (`AuthShell` + `LoginForm`/`RegisterForm` из `src/components`).
- `src/lib/api.ts` — клиент API (`login`, `register`, `getMe`, `ApiError`); `src/lib/session.ts` — JWT в `localStorage`. Запросы идут на `/api/*`, а `next.config.ts` (`rewrites`) проксирует их на бэкенд (`API_URL`, по умолчанию `http://localhost:3001`), поэтому CORS не нужен.
- `src/app` — маршруты App Router (`layout.tsx`, `page.tsx`, `globals.css` с Tailwind и HeroUI).
- Алиас путей `@/*` → `src/*`.
- `next.config.ts` включает `cacheComponents` и `partialPrefetching` — учитывать при работе с кэшированием и динамическими данными в Server Components.

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
