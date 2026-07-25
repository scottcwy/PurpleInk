/** 显式应用已提交的 Postgres migration；不会由 app/worker import 自动触发。 */
import { loadEnvConfig } from '@next/env'
import { migratePostgres } from '../../src/lib/db/migrate'

async function main(): Promise<void> {
  loadEnvConfig(process.cwd())
  await migratePostgres()
  console.log('[db] Postgres migrations applied')
}

void main().catch(() => {
  console.error('[db] Postgres migration failed')
  process.exitCode = 1
})
