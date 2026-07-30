import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadEnvConfig } from '@next/env'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../../src/lib/db/schema/index'

interface Arguments {
  apply: boolean
  cancelProjectIds: string[]
  outputPath: string
}

interface SafeRecord {
  table: string
  id: string
  projectId: string | null
  status: string
  createdAt: string | null
  updatedAt: string | null
  rowHash: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function main(): Promise<void> {
  loadEnvConfig(process.cwd())
  const args = parseArguments(process.argv.slice(2))
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED')
  const client = postgres(databaseUrl, { max: 1 })
  try {
    const projects = await client<Array<{ id: string; workspaceId: string }>>`
      select id::text, workspace_id::text as "workspaceId"
      from projects
      where id = any(${args.cancelProjectIds}::uuid[])
      order by id
    `
    if (projects.length !== args.cancelProjectIds.length) {
      throw new Error('RECOVERY_PROJECT_NOT_FOUND')
    }

    const before = await collectSafeSnapshot(client, args.cancelProjectIds)
    await writeJson(args.outputPath, {
      schemaVersion: 1,
      mode: args.apply ? 'apply-before' : 'dry-run',
      generatedAt: new Date().toISOString(),
      targetProjectIds: args.cancelProjectIds,
      records: before,
    })
    if (!args.apply) {
      console.log(JSON.stringify({
        status: 'dry-run',
        records: before.length,
        backup: args.outputPath,
      }))
      return
    }

    const [
      { runInAuthContext, SYSTEM_USER_ID },
      { stopProjectExecution },
      { sweepExpiredLeases },
      { reconcileStaleExecutionEpochs },
    ] = await Promise.all([
      import('../../src/lib/auth/workspace-context'),
      import('../../src/features/projects/project-execution-stop'),
      import('../../src/lib/queue/lease'),
      import('../../src/lib/queue/execution-reconciliation'),
    ])
    const database = drizzle(client, { schema })
    const stopResults = []
    for (const project of projects) {
      const result = await runInAuthContext(
        { workspaceId: project.workspaceId, userId: SYSTEM_USER_ID },
        () => stopProjectExecution(project.id, { database }),
      )
      stopResults.push({ projectId: project.id, ...result })
    }
    const interruptedAttemptIds = await sweepExpiredLeases(database)
    const staleAttemptIds = await reconcileStaleExecutionEpochs(database)
    const after = await collectSafeSnapshot(client, args.cancelProjectIds)
    const resultPath = resultOutputPath(args.outputPath)
    await writeJson(resultPath, {
      schemaVersion: 1,
      mode: 'apply-result',
      generatedAt: new Date().toISOString(),
      stopResults,
      interruptedAttemptIds,
      staleAttemptIds,
      records: after,
    })
    console.log(JSON.stringify({
      status: 'applied',
      stoppedProjects: stopResults.length,
      interruptedAttempts: interruptedAttemptIds.length,
      staleAttempts: staleAttemptIds.length,
      backup: args.outputPath,
      result: resultPath,
    }))
  } finally {
    await client.end({ timeout: 5 })
  }
}

function parseArguments(values: string[]): Arguments {
  const apply = values.includes('--apply')
  const cancelProjectIds = values
    .filter((value) => value.startsWith('--cancel-project='))
    .map((value) => value.slice('--cancel-project='.length))
  if (
    cancelProjectIds.length === 0
    || new Set(cancelProjectIds).size !== cancelProjectIds.length
    || cancelProjectIds.some((id) => !UUID.test(id))
  ) {
    throw new Error('RECOVERY_PROJECT_IDS_REQUIRED')
  }
  const outputFlag = values.find((value) => value.startsWith('--out='))
  const stamp = new Date().toISOString().replaceAll(':', '-')
  return {
    apply,
    cancelProjectIds,
    outputPath: path.resolve(
      outputFlag?.slice('--out='.length)
        || `.data/recovery/project-execution-${stamp}.json`,
    ),
  }
}

async function collectSafeSnapshot(
  client: postgres.Sql,
  projectIds: string[],
): Promise<SafeRecord[]> {
  const rows = await client<Array<{
    tableName: string
    id: string
    projectId: string | null
    status: string
    createdAt: Date | string | null
    updatedAt: Date | string | null
  }>>`
    select 'projects' as "tableName", p.id::text as id, p.id::text as "projectId",
      case when p.autopilot then 'autopilot' else 'stopped' end as status,
      p.created_at as "createdAt", p.updated_at as "updatedAt"
    from projects p
    where p.id = any(${projectIds}::uuid[])
    union all
    select 'pipeline_runs', r.id::text, r.project_id::text, r.status,
      r.created_at, r.updated_at
    from pipeline_runs r
    where r.project_id = any(${projectIds}::uuid[])
      and r.status in ('triggering', 'queued', 'running')
    union all
    select 'task_attempts', a.id::text, r.project_id::text, a.status,
      a.created_at, a.updated_at
    from task_attempts a
    join pipeline_runs r
      on r.workspace_id = a.workspace_id and r.id = a.run_id
    where r.project_id = any(${projectIds}::uuid[])
      and a.status in ('queued', 'running')
    union all
    select 'workflow_concurrency_leases',
      concat(l.project_id::text, ':', l.work_unit_key), l.project_id::text, l.status,
      l.requested_at, l.updated_at
    from workflow_concurrency_leases l
    where l.project_id = any(${projectIds}::uuid[])
      and l.status in ('waiting', 'active')
    union all
    select 'provider_dispatches', d.id::text, r.project_id::text, d.status,
      d.reserved_at, coalesce(d.released_at, d.started_at, d.reserved_at)
    from provider_dispatches d
    join task_attempts a
      on a.workspace_id = d.workspace_id and a.id = d.attempt_id
    join pipeline_runs r
      on r.workspace_id = a.workspace_id and r.id = a.run_id
    where r.project_id = any(${projectIds}::uuid[])
      and d.status in ('scheduled', 'in_flight')
    union all
    select 'ai_invocations', i.id::text, r.project_id::text,
      concat(i.status, ':', i.billing_status), i.created_at, i.updated_at
    from ai_invocations i
    join task_attempts a
      on a.workspace_id = i.workspace_id and a.id = i.attempt_id
    join pipeline_runs r
      on r.workspace_id = a.workspace_id and r.id = a.run_id
    where r.project_id = any(${projectIds}::uuid[])
      and i.status = 'running'
    union all
    select 'task_attempts:null_lease', a.id::text, r.project_id::text, a.status,
      a.created_at, a.updated_at
    from task_attempts a
    join pipeline_runs r
      on r.workspace_id = a.workspace_id and r.id = a.run_id
    where a.status = 'running'
      and a.lease_expires_at is null
      and a.started_at < now() - interval '20 minutes'
    order by 1, 2
  `
  return rows.map((row) => {
    const safe = {
      table: row.tableName,
      id: row.id,
      projectId: row.projectId,
      status: row.status,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    }
    return {
      ...safe,
      rowHash: createHash('sha256').update(JSON.stringify(safe)).digest('hex'),
    }
  })
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function resultOutputPath(outputPath: string): string {
  return outputPath.endsWith('.json')
    ? `${outputPath.slice(0, -5)}.result.json`
    : `${outputPath}.result.json`
}

async function writeJson(outputPath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true })
  const temporary = `${outputPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    })
    await rename(temporary, outputPath)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({
    status: 'failed',
    code: error instanceof Error ? error.message : 'PROJECT_EXECUTION_RECOVERY_FAILED',
  }))
  process.exitCode = 1
})
