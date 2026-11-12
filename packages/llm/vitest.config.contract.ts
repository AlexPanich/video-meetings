import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// LLM_PROVIDER, OLLAMA_URL и ключ берутся из корневого .env, как у api. Переменные, уже заданные
// в shell, loadEnvFile не перезаписывает. Воркеры vitest наследуют env этого процесса.
const rootEnv = source('../../.env')
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

// Контрактный набор ходит в живую модель (Ollama или Anthropic по LLM_PROVIDER),
// поэтому в `pnpm test` и pre-commit не входит. Запуск вручную:
//   LLM_CONTRACT=1 pnpm --filter @video-meetings/llm test:contract
export default defineConfig({
  resolve: {
    alias: {
      '@video-meetings/llm-sdk': source('../llm-sdk/src/index.ts'),
      '@video-meetings/llm': source('./src/index.ts'),
    },
  },
  test: {
    globals: true,
    include: ['test/contract/**/*.contract.ts'],
    testTimeout: 300_000,
  },
})
