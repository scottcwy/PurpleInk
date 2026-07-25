import path from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../../src/lib/db/schema/index'
import { importLegacyExport } from '../../src/lib/migration/legacy-import'

function manifestArgument(values: string[]): string {
  if (values.length !== 2 || values[0] !== '--manifest' || !values[1]) {
    throw new Error('INVALID_IMPORT_ARGUMENTS')
  }
  return path.resolve(values[1])
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED')
  const client = postgres(databaseUrl, { max: 1 })
  try {
    const result = await importLegacyExport({
      db: drizzle(client, { schema }),
      manifestPath: manifestArgument(process.argv.slice(2)),
      artifactRoot: path.resolve('.data/artifacts'),
    })
    console.log(JSON.stringify({
      status: 'ok',
      inserted: result.inserted,
      replayed: result.replayed,
      accounted: result.accounts.length,
    }))
  } finally {
    await client.end({ timeout: 5 })
  }
}

void main().catch(() => {
  console.error(JSON.stringify({
    status: 'failed',
    code: 'LEGACY_IMPORT_FAILED',
  }))
  process.exitCode = 1
})
