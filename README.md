# video-meetings

> Проект в разработке.

Сервис встреч: пользователь создаёт встречи и хранит при них материалы (записи, документы,
презентации), видит статус каждого файла и управляет своим профилем.

Сделано: регистрация и вход, встречи, загрузка файлов до 500 МиБ потоком (с прогрессом и
повтором), скачивание и удаление, профиль с аватаром и сменой пароля, отзыв всех токенов при
смене пароля и выходе, rate limiting, Swagger.

## Стек

| Часть            | Технологии                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Монорепо         | pnpm workspaces                                                                                                           |
| Web (`apps/web`) | Next.js 16 (App Router), React 19, HeroUI v3, Tailwind CSS 4; BFF: JWT в HttpOnly-cookie, потоковый прокси к API          |
| API (`apps/api`) | NestJS 12 (ESM), CQRS, JWT, Swagger, helmet                                                                               |
| База             | PostgreSQL 17, Prisma 7                                                                                                   |
| LLM (`packages`) | `llm-sdk` — интерфейс Claude Agent SDK поверх Ollama (Qwen3 в LAN); фасад `llm` выбирает его или Claude по `LLM_PROVIDER` |
| Тесты            | Vitest (unit в обоих приложениях), e2e API на supertest с реальной БД                                                     |
| Качество         | ESLint, Prettier, Husky (pre-commit: lint + тесты)                                                                        |

## Как сделан: AI-first

Код пишет агент (Claude Code), на мне постановка, решения и проверка. Процесс устроен так,
чтобы агент мог работать автономно, а качество проверялось автоматически, а не на доверии.

**Поток работы над фичей**

1. **PRD** — skill `prd`: требования, сценарии, критерии готовности
   (`docs/prd-*.md`).
2. **Research** — разбор вариантов реализации до кода (`docs/research-*.md`).
3. **План по фазам** — skill `plan-phase` (`docs/plan-*.md`). Первая задача каждой фазы —
   красные тесты на всю фазу (TDD).
4. **Issues** — skill `issues` раскладывает план на GitHub Issues по milestone.
5. **Реализация в Ralph-цикле.** `Stop`-hook ([`.claude/hooks/stop.js`](.claude/hooks/stop.js))
   берёт следующую открытую Issue milestone и запускает новую сессию `claude -p` с правилами из
   [`.claude/ralph.md`](.claude/ralph.md): одна итерация — одна Issue, коммит проходит
   pre-commit (lint + тесты), Issue закрывается со ссылкой на коммит. Когда milestone готов,
   hook открывает PR и запускает финальное ревью.
6. **Ревью.** Skill `review-all` запускает трёх субагентов-ревьюеров параллельно:
   [`security-reviewer`](.claude/agents/security-reviewer.md),
   [`performance-reviewer`](.claude/agents/performance-reviewer.md),
   [`test-coverage-reviewer`](.claude/agents/test-coverage-reviewer.md). Замечания
   исправляются отдельными коммитами в том же PR.

**Ограждения для агента**

- `.claude/settings.json`: разрешены только нужные команды (pnpm, git в feature-ветках, `gh`
  для issues и PR); запрещены force push, push в `main`, `reset --hard`, `rm -rf`, коммит в
  обход хуков (кроме коммита красных тестов).
- `PostToolUse`-hook форматирует Prettier каждый файл, который изменил агент.
- [`CLAUDE.md`](CLAUDE.md) в корне и в каждом приложении: архитектура, команды, подводные
  камни, правило обновлять документацию в том же изменении.

**Skills** — [`.claude/skills/`](.claude/skills/): свои (`prd`, `plan-phase`, `issues`,
`review-all`, `git-commit`) и подключённые (`vercel-react-best-practices`,
`nestjs-best-practices`, `heroui-react`, `requesting-code-review`), версии закреплены в
`skills-lock.json`.

## Запуск

Нужны Node.js 22+, pnpm 10 и Docker.

```bash
cp .env.example .env          # впишите JWT_SECRET: openssl rand -base64 48
pnpm install
docker compose up -d --wait   # PostgreSQL
pnpm --filter api prisma:migrate
pnpm dev                      # web — http://localhost:3000, API — http://localhost:3001
```

Проверки: `pnpm lint`, `pnpm test` (unit), `pnpm test:e2e` (e2e API, поднимает базу сам).
Swagger — `http://localhost:3001/docs` при `SWAGGER_ENABLED=true`.
