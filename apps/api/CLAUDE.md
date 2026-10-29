# CLAUDE.md — apps/api

Бэкенд `video-meetings`: NestJS 12 на Express, нативный ESM (`"type": "module"`, `module: nodenext`). Общие правила репозитория — в корневом `CLAUDE.md`.

## Команды

Запускать из корня через `pnpm --filter api <script>` или из этой папки через `pnpm <script>`:

- `build` — `nest build` (результат в `dist/`); `start:prod` — `node dist/main`
- `start:dev` — watch-режим; `start:debug` — watch + inspector
- `lint` — ESLint по `src` и `test`
- `test` — `vitest run` (unit); `test:watch`; `test:cov`; `test:debug`
- `test:e2e` — `vitest run --config ./vitest.config.e2e.ts`

Один тест: `pnpm --filter api test src/app.controller.spec.ts`.

## ESM

- Относительные импорты **обязательно с расширением `.js`**: `import { AppModule } from './app.module.js'` (даже для `.ts`-файлов).
- `src/main.ts` использует top-level `await`.
- Не использовать `require`/`__dirname`; для путей — `import.meta.url`.

## Структура

- `src/main.ts` — bootstrap, порт `process.env.PORT ?? 3000` (конфликтует с web — задавайте `PORT`).
- `src/app.module.ts`, `app.controller.ts`, `app.service.ts` — корневой модуль; новые фичи оформлять отдельными Nest-модулями (`nest g module|controller|service`).
- `dist/` — артефакты сборки, не править.

## Тесты

- Vitest (не Jest), `globals: true`, алиасы путей из `tsconfig.json` (`resolve.tsconfigPaths`).
- Unit-тесты: `src/**/*.spec.ts` рядом с исходниками.
- E2E: `test/*.e2e-spec.ts` на `supertest`, отдельный конфиг `vitest.config.e2e.ts`.

## Документация

При изменении архитектуры `apps/api` (модули, структура `src`, стек, зависимости, команды, конфиги, порты, env-переменные) обновляйте этот файл и корневой `CLAUDE.md` в том же изменении; убирайте устаревшие утверждения.
