/*
 * Disposable database-upgrade verification. It creates one temporary Postgres
 * container and two databases, never using DATABASE_URL or TEST_DATABASE_URL
 * from a developer environment.
 */
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import {
  assertAdminIndexDefinitions,
  assertUsersRoleCheckConstraint,
} from './database-upgrade-schema-contract'

const ROOT = process.cwd()
const YUSHENG_BASELINE = '2cb33c9a680722968c539917c21350e34bea0815'
const CURRENT_MIGRATIONS = path.join(ROOT, 'src', 'lib', 'db', 'migrations', 'pg')

async function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', value => { stdout += String(value) })
    child.stderr.on('data', value => { stderr += String(value) })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`${command} ${args.join(' ')} failed (${code}): ${stderr.trim()}`)))
  })
}

async function waitForPostgres(container: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await run('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', 'SELECT 1'])
      return
    } catch {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  throw new Error('temporary Postgres did not become ready')
}

async function migrateDatabase(url: string, migrationsFolder: string): Promise<void> {
  const client = postgres(url, { max: 1 })
  try {
    await migrate(drizzle(client), { migrationsFolder })
  } finally {
    await client.end({ timeout: 5 })
  }
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`missing ${label}`)
  return value
}

async function assertCurrentSchema(url: string, expectedHistoricalRole: boolean): Promise<void> {
  const client = postgres(url, { max: 1 })
  try {
    const [role] = await client<{ column_default: string | null; is_nullable: string }[]>`
      select column_default, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'users' and column_name = 'role'
    `
    if (role?.column_default !== "'user'::text" || role.is_nullable !== 'NO') {
      throw new Error(`users.role contract mismatch: ${JSON.stringify(role)}`)
    }
    const [counter] = await client<{ count: string }[]>`
      select count(*)::text as count from api_access_counters
    `
    if (counter?.count !== '0') throw new Error(`api_access_counters did not start empty: ${counter?.count}`)
    const indexRows = await client<{ indexname: string; indexdef: string }[]>`
      select index_class.relname as indexname, pg_get_indexdef(index_class.oid) as indexdef
      from pg_class index_class
      inner join pg_index index_metadata on index_metadata.indexrelid = index_class.oid
      inner join pg_class table_class on table_class.oid = index_metadata.indrelid
      inner join pg_namespace table_namespace on table_namespace.oid = table_class.relnamespace
      where table_namespace.nspname = 'public' and index_class.relname in (
        'ai_invocations_admin_telemetry_created_idx',
        'task_attempts_admin_status_created_idx',
        'task_attempts_admin_created_idx'
      )
    `
    assertAdminIndexDefinitions(new Map(indexRows.map(row => [row.indexname, row.indexdef])))
    const [roleConstraint] = await client<{ definition: string | null }[]>`
      select pg_get_constraintdef(constraint_metadata.oid) as definition
      from pg_constraint constraint_metadata
      inner join pg_class table_class on table_class.oid = constraint_metadata.conrelid
      inner join pg_namespace table_namespace on table_namespace.oid = table_class.relnamespace
      where table_namespace.nspname = 'public'
        and table_class.relname = 'users'
        and constraint_metadata.conname = 'users_role_check'
    `
    assertUsersRoleCheckConstraint(roleConstraint?.definition ?? null)
    const [renderJobs] = await client<{ count: string }[]>`
      select count(*)::text as count
      from information_schema.tables
      where table_schema = 'public' and table_name = 'render_jobs'
    `
    if (renderJobs?.count !== '0') throw new Error('forbidden render_jobs table exists')
    const [journal] = await client<{ count: string }[]>`
      select count(*)::text as count from drizzle.__drizzle_migrations
    `
    if (journal?.count !== '32') throw new Error(`unexpected migration count: ${journal?.count}`)
    const [legacyRole] = await client<{ role: string }[]>`
      select role from users where email = 'legacy-role@example.test'
    `
    if (expectedHistoricalRole && legacyRole?.role !== 'user') {
      throw new Error(`historical user role was not preserved as user: ${legacyRole?.role ?? 'missing'}`)
    }
  } finally {
    await client.end({ timeout: 5 })
  }
}

async function addHistoricalUser(url: string): Promise<void> {
  const client = postgres(url, { max: 1 })
  try {
    await client`
      insert into users (email, name, password_hash)
      values ('legacy-role@example.test', 'Legacy Role', 'not-a-real-password-hash')
    `
  } finally {
    await client.end({ timeout: 5 })
  }
}

async function main(): Promise<void> {
  const suffix = randomBytes(6).toString('hex')
  const container = `purpleink-predev-db-gate-${suffix}`
  const archiveRoot = await mkdtemp(path.join(os.tmpdir(), 'purpleink-archive-'))
  const archiveTar = path.join(archiveRoot, 'migrations.tar')
  const archiveMigrations = path.join(archiveRoot, 'src', 'lib', 'db', 'migrations', 'pg')
  let started = false
  try {
    await run('docker', ['run', '--detach', '--rm', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', '127.0.0.1::5432', 'postgres:17.5-alpine'])
    started = true
    await waitForPostgres(container)
    const portLine = (await run('docker', ['port', container, '5432/tcp'])).trim()
    const port = required(portLine.match(/:(\d+)$/m)?.[1], 'temporary Postgres port')
    await run('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE gate_empty'])
    await run('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE gate_archive'])
    const baseUrl = `postgres://postgres@127.0.0.1:${port}`

    await migrateDatabase(`${baseUrl}/gate_empty`, CURRENT_MIGRATIONS)
    await migrateDatabase(`${baseUrl}/gate_empty`, CURRENT_MIGRATIONS)
    await assertCurrentSchema(`${baseUrl}/gate_empty`, false)

    await mkdir(archiveRoot, { recursive: true })
    await run('git', ['archive', '--format=tar', '--output', archiveTar, YUSHENG_BASELINE, 'src/lib/db/migrations/pg'])
    await run('tar', ['-xf', archiveTar, '-C', archiveRoot])
    await migrateDatabase(`${baseUrl}/gate_archive`, archiveMigrations)
    await addHistoricalUser(`${baseUrl}/gate_archive`)
    await migrateDatabase(`${baseUrl}/gate_archive`, CURRENT_MIGRATIONS)
    await migrateDatabase(`${baseUrl}/gate_archive`, CURRENT_MIGRATIONS)
    await assertCurrentSchema(`${baseUrl}/gate_archive`, true)

    console.log(JSON.stringify({
      ok: true,
      container: 'temporary',
      databases: ['gate_empty', 'gate_archive'],
      archiveBaseline: YUSHENG_BASELINE,
      currentMigrations: ['0029_bored_red_ghost', '0030_steady_venus', '0031_tiny_spencer_smythe'],
    }))
  } finally {
    if (started) await run('docker', ['rm', '--force', container]).catch(() => undefined)
    await rm(archiveRoot, { recursive: true, force: true })
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
