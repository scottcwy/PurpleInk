import { randomUUID } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../../src/lib/db/schema/index'
import { reconcileLegacyImport } from '../../src/lib/migration/legacy-reconcile'

function parseArguments(values: string[]): {
  manifestPath: string
  outputPath: string
} {
  if (values.length !== 4) throw new Error('INVALID_RECONCILE_ARGUMENTS')
  const parsed = new Map<string, string>()
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index]
    const value = values[index + 1]
    if (!flag || !value || parsed.has(flag)) {
      throw new Error('INVALID_RECONCILE_ARGUMENTS')
    }
    parsed.set(flag, value)
  }
  if (parsed.size !== 2 || !parsed.has('--manifest') || !parsed.has('--out')) {
    throw new Error('INVALID_RECONCILE_ARGUMENTS')
  }
  return {
    manifestPath: path.resolve(parsed.get('--manifest')!),
    outputPath: path.resolve(parsed.get('--out')!),
  }
}

async function writeReport(
  outputPath: string,
  report: Awaited<ReturnType<typeof reconcileLegacyImport>>,
): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true })
  const temporary = `${outputPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    })
    await rename(temporary, outputPath)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED')
  const args = parseArguments(process.argv.slice(2))
  const client = postgres(databaseUrl, { max: 1 })
  try {
    const report = await reconcileLegacyImport({
      db: drizzle(client, { schema }),
      manifestPath: args.manifestPath,
    })
    await writeReport(args.outputPath, report)
    console.log(JSON.stringify({
      status: 'ok',
      reconciled: report.ok,
      tables: report.tables.length,
    }))
    if (!report.ok) process.exitCode = 2
  } finally {
    await client.end({ timeout: 5 })
  }
}

void main().catch(() => {
  console.error(JSON.stringify({
    status: 'failed',
    code: 'LEGACY_RECONCILIATION_FAILED',
  }))
  process.exitCode = 1
})
