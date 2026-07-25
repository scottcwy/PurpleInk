import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

process.loadEnvFile('.env.local')

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.pg.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
