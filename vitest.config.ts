import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.{ts,tsx}'],
    exclude: [
      ...configDefaults.exclude,
      '**/*.pg.test.ts',
      // Stage A explicitly removes these historical Trigger and SQLite contracts.
      'src/features/pipeline/contracts/contracts.test.ts',
      'src/features/pipeline/contracts/task-source-boundary.test.ts',
      'src/lib/db/runtime-boundary.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
