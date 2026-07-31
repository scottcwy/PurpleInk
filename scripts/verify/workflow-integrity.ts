import { loadEnvConfig } from '@next/env'
import postgres from 'postgres'
import {
  summarizeWorkflowIntegrity,
  type WorkflowIntegrityFinding,
} from './workflow-integrity-result'

interface CountRow {
  check: string
  count: number
  blocking: boolean
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd())
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED')
  const client = postgres(databaseUrl, { max: 1 })
  try {
    const rows = await client<CountRow[]>`
      select 'terminal_attempt_running_invocation' as "check",
        count(*)::int as count, true as blocking
      from ai_invocations i
      left join task_attempts a
        on a.workspace_id = i.workspace_id and a.id = i.attempt_id
      left join pipeline_runs r
        on r.workspace_id = a.workspace_id and r.id = a.run_id
      left join projects p
        on p.workspace_id = r.workspace_id and p.id = r.project_id
      where i.status = 'running'
        and i.attempt_id is not null
        and (
          a.id is null or a.status not in ('queued', 'running')
          or r.id is null or p.id is null
          or r.execution_epoch <> p.execution_epoch
        )
      union all
      select 'orphan_active_workflow_lease', count(*)::int, true
      from workflow_concurrency_leases l
      where l.status in ('waiting', 'active')
        and not exists (
          select 1
          from task_attempts a
          join pipeline_runs r
            on r.workspace_id = a.workspace_id and r.id = a.run_id
          where a.workspace_id = l.workspace_id
            and r.project_id = l.project_id
            and a.work_unit_key = l.work_unit_key
            and a.status in ('queued', 'running')
        )
      union all
      select 'orphan_active_provider_dispatch', count(*)::int, true
      from provider_dispatches d
      left join task_attempts a
        on a.workspace_id = d.workspace_id and a.id = d.attempt_id
      left join pipeline_runs r
        on r.workspace_id = a.workspace_id and r.id = a.run_id
      left join projects p
        on p.workspace_id = r.workspace_id and p.id = r.project_id
      where d.status in ('scheduled', 'in_flight')
        and (
          a.id is null or a.status not in ('queued', 'running')
          or r.id is null or p.id is null
          or r.execution_epoch <> p.execution_epoch
        )
      union all
      select 'telemetry_v3_identity_missing', count(*)::int, true
      from ai_invocations i
      where i.telemetry_version >= 3 and (
        i.logical_model_id is null or i.outbound_model_id is null
        or i.deployment_id is null or i.channel_id is null
        or i.adapter_protocol is null or i.official_price_identity is null
        or i.provider_pool_id is null or i.failure_domain_id is null
        or i.plan_version is null
      )
      union all
      select 'invalid_artifact_evidence', count(*)::int, true
      from artifacts a
      where a.size_bytes <= 0
        or a.content_hash !~ '^[0-9a-f]{64}$'
        or not exists (
          select 1 from task_attempts t
          where t.workspace_id = a.workspace_id and t.id = a.attempt_id
        )
      union all
      select 'active_execution_epoch_mismatch', count(*)::int, true
      from task_attempts a
      join pipeline_runs r
        on r.workspace_id = a.workspace_id and r.id = a.run_id
      join projects p
        on p.workspace_id = r.workspace_id and p.id = r.project_id
      where a.status in ('queued', 'running')
        and r.execution_epoch <> p.execution_epoch
      union all
      select 'historical_timestamp_inversion', (
        (select count(*) from task_attempts
          where started_at is not null and completed_at < started_at)
        + (select count(*) from provider_dispatches
          where released_at is not null and released_at < reserved_at)
        + (select count(*) from ai_invocations
          where completed_at is not null and completed_at < created_at)
      )::int, false
      order by 1
    `
    const checkedAt = await databaseClock(client)
    const findings: WorkflowIntegrityFinding[] = rows.map((row) => ({
      check: row.check,
      count: row.count,
      blocking: row.blocking,
    }))
    const summary = summarizeWorkflowIntegrity(findings, checkedAt)
    console.log(JSON.stringify(summary))
    if (!summary.ok && !process.argv.includes('--report')) process.exitCode = 1
  } finally {
    await client.end({ timeout: 5 })
  }
}

async function databaseClock(client: postgres.Sql): Promise<string> {
  const [row] = await client<Array<{ now: Date | string }>>`
    select now() as now
  `
  if (!row) throw new Error('DATABASE_CLOCK_UNAVAILABLE')
  return row.now instanceof Date ? row.now.toISOString() : new Date(row.now).toISOString()
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(JSON.stringify({ ok: false, error: message }))
  process.exitCode = 1
})
