import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmod, lstat, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createSqliteOnlineBackup } from '../../src/lib/migration/sqlite-online-backup'

const FIXED_ARGUMENTS = {
  '--source': '.data/app.db',
  '--destination': '.data/legacy-sqlite-archives/baseline-before-postgres/app.db',
  '--report':
    '.data/legacy-sqlite-archives/baseline-before-postgres/backup-report.json',
} as const

type CliFlag = keyof typeof FIXED_ARGUMENTS

interface CliArguments {
  source: string
  destination: string
  report: string
}

interface InventoryEntry {
  label: 'db' | 'wal' | 'shm'
  name: string
  sizeBytes: number | null
  mtimeUtc: string | null
}

class CliInputError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'CliInputError'
  }
}

function isCliFlag(value: string): value is CliFlag {
  return Object.hasOwn(FIXED_ARGUMENTS, value)
}

function parseCliArguments(values: string[]): CliArguments {
  if (values.length !== 6) throw new CliInputError('INVALID_ARGUMENT_COUNT')

  const seen = new Set<CliFlag>()
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index]
    const value = values[index + 1]
    if (!flag || !isCliFlag(flag)) throw new CliInputError('UNKNOWN_FLAG')
    if (seen.has(flag)) throw new CliInputError('DUPLICATE_FLAG')
    if (value !== FIXED_ARGUMENTS[flag]) {
      throw new CliInputError('INVALID_FLAG_VALUE')
    }
    seen.add(flag)
  }

  if (seen.size !== 3) throw new CliInputError('MISSING_FLAG')
  return {
    source: FIXED_ARGUMENTS['--source'],
    destination: FIXED_ARGUMENTS['--destination'],
    report: FIXED_ARGUMENTS['--report'],
  }
}

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

async function readInventory(
  label: InventoryEntry['label'],
  filePath: string,
): Promise<InventoryEntry> {
  try {
    const details = await stat(filePath)
    return {
      label,
      name: path.basename(filePath),
      sizeBytes: details.size,
      mtimeUtc: details.mtime.toISOString(),
    }
  } catch (error) {
    if (!isFileSystemError(error) || error.code !== 'ENOENT') throw error
    return {
      label,
      name: path.basename(filePath),
      sizeBytes: null,
      mtimeUtc: null,
    }
  }
}

async function printSourceInventory(sourcePath: string): Promise<void> {
  const entries = await Promise.all([
    readInventory('db', sourcePath),
    readInventory('wal', `${sourcePath}-wal`),
    readInventory('shm', `${sourcePath}-shm`),
  ])
  for (const entry of entries) console.log(JSON.stringify(entry))
}

async function assertReportAbsent(reportPath: string): Promise<void> {
  try {
    await lstat(reportPath)
  } catch (error) {
    if (isFileSystemError(error) && error.code === 'ENOENT') return
    throw error
  }
  throw new CliInputError('REPORT_ALREADY_EXISTS')
}

async function setSnapshotReadOnly(snapshotPath: string): Promise<void> {
  if (process.platform !== 'win32') {
    await chmod(snapshotPath, 0o444)
    return
  }
  await new Promise<void>((resolve, reject) => {
    execFile(
      'attrib.exe',
      ['+R', snapshotPath],
      { windowsHide: true },
      (error) => (error ? reject(error) : resolve()),
    )
  })
}

async function writeReportAtomically(
  reportPath: string,
  report: Awaited<ReturnType<typeof createSqliteOnlineBackup>>,
): Promise<void> {
  const directory = path.dirname(reportPath)
  const temporaryPath = path.join(
    directory,
    `.${path.basename(reportPath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  let pendingTemporaryPath: string | null = temporaryPath
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(report, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    )
    await rename(temporaryPath, reportPath)
    pendingTemporaryPath = null
  } finally {
    if (pendingTemporaryPath) {
      await unlink(pendingTemporaryPath).catch(() => undefined)
    }
  }
}

async function removeValidatedSnapshot(
  snapshotPath: string,
  originalError: unknown,
): Promise<void> {
  await chmod(snapshotPath, 0o666).catch(() => undefined)
  try {
    await unlink(snapshotPath)
  } catch (error) {
    if (isFileSystemError(error) && error.code === 'ENOENT') return
    throw new AggregateError(
      [originalError, error],
      'BACKUP_SNAPSHOT_CLEANUP_FAILED',
    )
  }
}

function safeErrorCode(error: unknown): string {
  if (error instanceof CliInputError) return error.code
  if (isFileSystemError(error) && typeof error.code === 'string') {
    return error.code
  }
  return 'BACKUP_FAILED'
}

async function main(): Promise<void> {
  const args = parseCliArguments(process.argv.slice(2))
  const sourcePath = path.resolve(args.source)
  const destinationPath = path.resolve(args.destination)
  const reportPath = path.resolve(args.report)

  await assertReportAbsent(reportPath)
  await printSourceInventory(sourcePath)
  const report = await createSqliteOnlineBackup({ sourcePath, destinationPath })
  try {
    await setSnapshotReadOnly(destinationPath)
    await writeReportAtomically(reportPath, report)
  } catch (error) {
    await removeValidatedSnapshot(destinationPath, error)
    throw error
  }
  console.log(
    JSON.stringify({
      status: 'ok',
      snapshot: path.basename(destinationPath),
      report: path.basename(reportPath),
    }),
  )
}

void main().catch((error: unknown) => {
  console.error(
    JSON.stringify({ status: 'failed', code: safeErrorCode(error) }),
  )
  process.exitCode = 1
})
