# CLAUDE.md — apps/web

Фронтенд `video-meetings`: Next.js 16 (App Router), React 19, TypeScript. Общие правила репозитория — в корневом `CLAUDE.md`.

## Команды

Запускать из корня через `pnpm --filter web <script>` или из этой папки через `pnpm <script>`:

- `dev` / `build` / `start` — Next.js
- `lint` — ESLint (`eslint-config-next` + `eslint-config-prettier`)
- `typecheck` — `next typegen && tsc --noEmit`
- `test` — `vitest run`; `test:watch` — watch-режим

Один тест: `pnpm --filter web test src/app/page.test.tsx -t "renders main heading"`.

## Структура

- `src/app` — маршруты App Router (`layout.tsx`, `page.tsx`, стили `*.module.css`, `globals.css`).
- Алиас путей `@/*` → `src/*`.
- `next.config.ts` включает `cacheComponents` и `partialPrefetching` — учитывать при работе с кэшированием и динамическими данными в Server Components.

## Тесты

- Vitest, окружение jsdom, `globals: true` (`describe`/`it`/`expect` без импортов).
- `@testing-library/react`; jest-dom-матчеры подключены в `vitest.setup.ts`.
- Тесты лежат рядом с кодом: `src/**/*.{test,spec}.{ts,tsx}`.

## UI

Планируется HeroUI (скилл `heroui-react`), пока не установлен как зависимость. Перед добавлением компонентов — установить `@heroui/react` и свериться со скиллом.

## Особенности

- По умолчанию dev-сервер на порту 3000, как и API — при одновременном запуске задавайте `PORT` для API.
- `.next`, `next-env.d.ts` и `tsconfig.tsbuildinfo` — генерируемые файлы, не править вручную.

## Документация

При изменении архитектуры `apps/web` (структура `src`, маршруты, стек, зависимости, команды, конфиги) обновляйте этот файл и корневой `CLAUDE.md` в том же изменении; убирайте устаревшие утверждения (например, про HeroUI, когда он будет установлен).
