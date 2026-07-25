import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCredentialMasterKey } from '@/features/credentials/credential-envelope'
import { exportLegacySqlite } from '@/lib/migration/legacy-export'

const MASTER_KEY_NAME = 'CVC_CREDENTIAL_MASTER_KEY'

interface CliOptions {
  snapshot: string
  backupReport: string
  out: string
  artifactRoot: string
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const manifest = await exportLegacySqlite({
    snapshotPath: options.snapshot,
    backupReportPath: options.backupReport,
    outDir: options.out,
    artifactRoot: options.artifactRoot,
    masterKey: loadPersistentMasterKey(),
  })
  const counts = Object.fromEntries(manifest.tables.map((table) => [
    table.sourceTable,
    table.sourceCount,
  ]))
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    snapshotSha256: manifest.snapshotSha256,
    counts,
    dispositions: manifest.archivedDispositions.length,
  })}\n`)
}

function parseArgs(args: string[]): CliOptions {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (!flag?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error('invalid export arguments')
    }
    if (values.has(flag)) throw new Error(`duplicate argument: ${flag}`)
    values.set(flag, value)
  }
  const allowed = new Set([
    '--snapshot',
    '--backup-report',
    '--out',
    '--artifact-root',
  ])
  if ([...values.keys()].some((key) => !allowed.has(key))) {
    throw new Error('unknown export argument')
  }
  const snapshot = values.get('--snapshot')
  const backupReport = values.get('--backup-report')
  const out = values.get('--out')
  if (!snapshot || !backupReport || !out) {
    throw new Error('--snapshot, --backup-report and --out are required')
  }
  return {
    snapshot,
    backupReport,
    out,
    artifactRoot: values.get('--artifact-root')
      ?? path.join('.data', 'artifacts'),
  }
}

export function loadPersistentMasterKey(
  envPath = '.env.local',
): Uint8Array {
  const inherited = process.env[MASTER_KEY_NAME]
  delete process.env[MASTER_KEY_NAME]
  try {
    process.loadEnvFile(envPath)
    const persisted = process.env[MASTER_KEY_NAME]
    if (!persisted) throw new Error(`${MASTER_KEY_NAME} is missing from ${envPath}`)
    if (inherited !== undefined && inherited !== persisted) {
      throw new Error(`${MASTER_KEY_NAME} does not match ${envPath}`)
    }
    return parseCredentialMasterKey(persisted)
  } catch (error) {
    restoreInheritedKey(inherited)
    throw error
  }
}

function restoreInheritedKey(value: string | undefined): void {
  if (value === undefined) delete process.env[MASTER_KEY_NAME]
  else process.env[MASTER_KEY_NAME] = value
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write(`${JSON.stringify({
      status: 'failed',
      code: 'LEGACY_EXPORT_FAILED',
    })}\n`)
    process.exitCode = 1
  })
}
