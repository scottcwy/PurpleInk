import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadEnvConfig } from '@next/env'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { reconcileOrphanedAiInvocationsInDatabase } from '../../src/features/ai/invocation-recovery-core'
import { reconcileOrphanedWorkflowLeases } from '../../src/lib/queue/execution-reconciliation'
import * as schema from '../../src/lib/db/schema'

interface CandidateRow {
  kind: 'invocation' | 'lease'
  workspaceId: string
  id: string
  projectId: string | null
  attemptId: string | null
  status: string
  parentStatus: string | null
  runEpoch: number | null
  projectEpoch: number | null
  providerStarted: boolean | null
  billingStatus: string | null
  createdAt: string
  updatedAt: string
}

interface Arguments { apply: boolean; outputPath?: string }

async function main(): Promise<void> {
  loadEnvConfig(process.cwd())
  const args = parseArguments(process.argv.slice(2))
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED')
  const client = postgres(databaseUrl, { max: 1 })
  const database = drizzle(client, { schema })
  try {
    const before = await readCandidates(client)
    const applied = args.apply
      ? {
          invocationIds: await reconcileOrphanedAiInvocationsInDatabase(database),
          leaseCount: await reconcileOrphanedWorkflowLeases(database),
        }
      : null
    const after = args.apply ? await readCandidates(client) : []
    const [clock] = await client<Array<{ now: string }>>`select now()::text as now`
    const report = {
      schemaVersion: 1,
      mode: args.apply ? 'apply' : 'dry-run',
      checkedAt: clock.now,
      before: snapshot(before),
      applied,
      after: args.apply ? snapshot(after) : null,
    }
    const serialized = `${JSON.stringify(report, null, 2)}\n`
    if (args.outputPath) {
      const outputPath = path.resolve(args.outputPath)
      await mkdir(path.dirname(outputPath), { recursive: true })
      await writeFile(outputPath, serialized, 'utf8')
    }
    console.log(serialized.trimEnd())
    if (args.apply && after.length > 0) process.exitCode = 1
  } finally {
    await client.end({ timeout: 5 })
  }
}

function parseArguments(values: string[]): Arguments {
  const result: Arguments = { apply: false }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === '--apply') result.apply = true
    else if (value === '--output') {
      const outputPath = values[index + 1]
      if (!outputPath) throw new Error('--output requires a path')
      result.outputPath = outputPath
      index += 1
    } else throw new Error(`unknown argument: ${value}`)
  }
  return result
}

function snapshot(rows: CandidateRow[]) {
  return {
    count: rows.length,
    records: rows.map((row) => ({
      ...row,
      rowHash: createHash('sha256').update(JSON.stringify(row)).digest('hex'),
    })),
  }
}

async function readCandidates(client: postgres.Sql): Promise<CandidateRow[]> {
  const invocations = await client<CandidateRow[]>`
    select 'invocation'::text as kind,
      i.workspace_id::text as "workspaceId", i.id::text as id,
      r.project_id::text as "projectId", i.attempt_id::text as "attemptId",
      i.status, a.status as "parentStatus",
      r.execution_epoch::int as "runEpoch", p.execution_epoch::int as "projectEpoch",
      (i.provider_started_at is not null) as "providerStarted",
      i.billing_status as "billingStatus",
      i.created_at::text as "createdAt", i.updated_at::text as "updatedAt"
    from ai_invocations i
    left join task_attempts a
      on a.workspace_id = i.workspace_id and a.id = i.attempt_id
    left join pipeline_runs r
      on r.workspace_id = a.workspace_id and r.id = a.run_id
    left join projects p
      on p.workspace_id = r.workspace_id and p.id = r.project_id
    where i.status = 'running' and i.attempt_id is not null
      and (
        a.id is null or a.status not in ('queued', 'running')
        or r.id is null or p.id is null
        or r.execution_epoch <> p.execution_epoch
      )
    order by i.created_at, i.id
  `
  const leases = await client<CandidateRow[]>`
    select 'lease'::text as kind,
      l.workspace_id::text as "workspaceId", l.work_unit_key as id,
      l.project_id::text as "projectId", parent.attempt_id as "attemptId",
      l.status, parent.attempt_status as "parentStatus",
      parent.run_epoch as "runEpoch", p.execution_epoch::int as "projectEpoch",
      null::boolean as "providerStarted", null::text as "billingStatus",
      l.requested_at::text as "createdAt", l.updated_at::text as "updatedAt"
    from workflow_concurrency_leases l
    join projects p
      on p.workspace_id = l.workspace_id and p.id = l.project_id
    left join lateral (
      select a.id::text as attempt_id, a.status as attempt_status,
        r.execution_epoch::int as run_epoch
      from task_attempts a
      join pipeline_runs r
        on r.workspace_id = a.workspace_id and r.id = a.run_id
      where a.workspace_id = l.workspace_id
        and r.project_id = l.project_id
        and a.work_unit_key = l.work_unit_key
      order by a.created_at desc, a.id desc
      limit 1
    ) parent on true
    where l.status in ('waiting', 'active')
      and not exists (
        select 1
        from task_attempts active_attempt
        join pipeline_runs active_run
          on active_run.workspace_id = active_attempt.workspace_id
         and active_run.id = active_attempt.run_id
        where active_attempt.workspace_id = l.workspace_id
          and active_run.project_id = l.project_id
          and active_attempt.work_unit_key = l.work_unit_key
          and active_attempt.status in ('queued', 'running')
          and active_run.execution_epoch = p.execution_epoch
      )
    order by l.requested_at, l.work_unit_key
  `
  return [...invocations, ...leases]
}

void main().catch((error: unknown) => {
  console.error('[workflow-recovery-failed]', {
    message: error instanceof Error ? error.message : 'unknown error',
  })
  process.exitCode = 1
})
