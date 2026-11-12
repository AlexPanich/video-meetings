// @ts-check
import eslint from '@eslint/js'
import prettier from 'eslint-config-prettier'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.vitest,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    // Фикстуры тестов: синхронные async-генераторы промптов и мок fetch, который отклоняется
    // `signal.reason` как настоящий fetch.
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
    },
  },
)
