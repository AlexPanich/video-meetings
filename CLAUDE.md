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

## Testing setup

- Both apps use **Vitest** (not Jest) with `globals: true` — `describe`/`it`/`expect` are available without imports.
- web: jsdom environment, `@testing-library/react`, jest-dom matchers loaded in `vitest.setup.ts`; tests are `src/**/*.{test,spec}.{ts,tsx}`, colocated with the code.
- api: unit tests are `*.spec.ts` next to sources; e2e tests are `test/*.e2e-spec.ts` using `supertest`.

## Gotchas

- Both apps default to port 3000 (Next dev and `process.env.PORT ?? 3000` in `apps/api/src/main.ts`). Set `PORT` for the API when running `pnpm dev`.
- `pnpm-workspace.yaml` whitelists dependency build scripts (`onlyBuiltDependencies`); new packages that need postinstall scripts must be added there.

## Code style

Prettier (root `.prettierrc`): single quotes, trailing commas, no semicolons, `printWidth: 100`. 2-space indent, LF. ESLint in each app extends `eslint-config-prettier`, so formatting is Prettier's job only.

## UI library

`skills-lock.json` pins the `heroui-react` skill (HeroUI), indicating HeroUI is the intended component library for `apps/web`, though it is not yet installed as a dependency.

## Keeping docs up to date

When a change alters the architecture — new/removed apps or shared packages, module or directory structure, tech stack or major dependencies, build/test/dev commands, ports, env vars, or conventions — update the affected documentation **in the same change**: this root `CLAUDE.md`, the `CLAUDE.md` of each touched app (`apps/*/CLAUDE.md`), and any README. Remove statements that are no longer true (e.g. "no shared package yet", "HeroUI is not installed").

## Hooks

`.claude/settings.json` defines a `PostToolUse` hook (`Write|Edit`) that runs `prettier --write` on every file Claude changes; files matched by `.prettierignore` or unsupported by Prettier are skipped. No manual formatting is needed after edits.
