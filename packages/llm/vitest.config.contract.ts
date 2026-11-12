import { defineConfig } from 'vitest/config'

// Контрактный набор ходит в живую модель (Ollama или Anthropic по LLM_PROVIDER),
// поэтому в `pnpm test` и pre-commit не входит. Запуск вручную:
//   LLM_CONTRACT=1 pnpm --filter @video-meetings/llm test:contract
export default defineConfig({
  test: {
    globals: true,
    include: ['test/contract/**/*.contract.ts'],
    testTimeout: 300_000,
  },
})
