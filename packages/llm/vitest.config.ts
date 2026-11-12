import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.spec.ts'],
    unstubEnvs: true,
    unstubGlobals: true,
    restoreMocks: true,
  },
})
