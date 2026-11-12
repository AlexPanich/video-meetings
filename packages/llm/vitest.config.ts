import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Исходники локального SDK: тесты не требуют его сборки.
    alias: {
      '@video-meetings/llm-sdk': fileURLToPath(new URL('../llm-sdk/src/index.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    include: ['src/**/*.spec.ts'],
    unstubEnvs: true,
    unstubGlobals: true,
    restoreMocks: true,
  },
})
