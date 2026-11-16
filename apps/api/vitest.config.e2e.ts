import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // файлы по очереди: каждый поднимает AppModule, а при старте api задачи саммари в
    // pending/generating помечаются failed — параллельный файл ломал бы идущую задачу summary.e2e-spec.ts
    fileParallelism: false,
    // высокий лимит, чтобы остальные e2e не упирались в rate limiting (его проверяет rate-limit.e2e-spec.ts)
    env: {
      JWT_SECRET: 'e2e-test-secret-at-least-32-bytes-long',
      AUTH_RATE_LIMIT: '100000',
      SWAGGER_ENABLED: 'true',
      // LLM — локальный SDK, запросы к Ollama перехватывает test/support/llm-mock.ts
      LLM_PROVIDER: 'local',
      OLLAMA_URL: 'http://ollama.test:11434',
    },
  },
})
