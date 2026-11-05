import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // высокий лимит, чтобы остальные e2e не упирались в rate limiting (его проверяет rate-limit.e2e-spec.ts)
    env: { JWT_SECRET: 'e2e-test-secret-at-least-32-bytes-long', AUTH_RATE_LIMIT: '100000' },
  },
})
