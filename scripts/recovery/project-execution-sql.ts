import postgres from 'postgres'

export interface ProjectExecutionRecoveryResult {
  cancelledProjects: number
  cancelledAttempts: number
  cancelledRuns: number
  cancelledLeases: number
  cancelledTickets: number
  interruptedAttemptIds: string[]
  staleAttemptIds: string[]
}

export async function applyProjectExecutionRecovery(
  client: postgres.Sql,
  projectIds: string[],
): Promise<ProjectExecutionRecoveryResult> {
  return client.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtextextended('purpleink:project-recovery', 0))`
    await assertNoActiveExternalWork(transaction, projectIds)
    const queuedAttempts = await transaction<Array<{
      id: string
      entityType: string
      entityId: string
    }>>`
      select a.id::text, a.entity_type as "entityType", a.entity_id::text as "entityId"
      from task_attempts a
      join pipeline_runs r
        on r.workspace_id = a.workspace_id and r.id = a.run_id
      where r.project_id = any(${projectIds}::uuid[]) and a.status = 'queued'
      for update of a
    `
    const cancelledProjects = await transaction`
      update projects p
      set autopilot = false, execution_epoch = execution_epoch + 1, updated_at = now()
      where p.id = any(${projectIds}::uuid[])
        and (
          p.autopilot
          or exists (
            select 1 from pipeline_runs r join task_attempts a
              on a.workspace_id = r.workspace_id and a.run_id = r.id
            where r.workspace_id = p.workspace_id and r.project_id = p.id
              and a.status in ('queued', 'running')
          )
        )
      returning p.id
    `
    const queuedIds = queuedAttempts.map(({ id }) => id)
    await cancelQueuedAttempts(transaction, queuedAttempts)
    const cancelledRuns = await transaction`
      update pipeline_runs set status = 'cancelled', completed_at = now(), updated_at = now()
      where project_id = any(${projectIds}::uuid[])
        and status in ('triggering', 'queued')
      returning id
    `
    const cancelledLeases = await transaction`
      update workflow_concurrency_leases
      set status = 'cancelled', lease_expires_at = null,
        released_at = now(), updated_at = now()
      where project_id = any(${projectIds}::uuid[])
        and status in ('waiting', 'active')
      returning work_unit_key
    `
    const cancelledTickets = queuedIds.length === 0 ? [] : await transaction`
      update provider_dispatches
      set status = 'cancelled', released_at = now()
      where attempt_id = any(${queuedIds}::uuid[]) and status = 'scheduled'
      returning id
    `
    return {
      cancelledProjects: cancelledProjects.length,
      cancelledAttempts: queuedIds.length,
      cancelledRuns: cancelledRuns.length,
      cancelledLeases: cancelledLeases.length,
      cancelledTickets: cancelledTickets.length,
      interruptedAttemptIds: await recoverHistoricalZombies(transaction),
      staleAttemptIds: await recoverStaleEpochs(transaction),
    }
  })
}

async function assertNoActiveExternalWork(
  transaction: postgres.TransactionSql,
  projectIds: string[],
): Promise<void> {
  const [blockers] = await transaction<Array<{
    runningAttempts: number
    activeInvocations: number
    inflightTickets: number
  }>>`
    select
      (select count(*)::int
        from task_attempts a join pipeline_runs r
          on r.workspace_id = a.workspace_id and r.id = a.run_id
        where r.project_id = any(${projectIds}::uuid[]) and a.status = 'running'
      ) as "runningAttempts",
      (select count(*)::int
        from ai_invocations i join task_attempts a
          on a.workspace_id = i.workspace_id and a.id = i.attempt_id
        join pipeline_runs r
          on r.workspace_id = a.workspace_id and r.id = a.run_id
        where r.project_id = any(${projectIds}::uuid[]) and i.status = 'running'
      ) as "activeInvocations",
      (select count(*)::int
        from provider_dispatches d join task_attempts a
          on a.workspace_id = d.workspace_id and a.id = d.attempt_id
        join pipeline_runs r
          on r.workspace_id = a.workspace_id and r.id = a.run_id
        where r.project_id = any(${projectIds}::uuid[]) and d.status = 'in_flight'
      ) as "inflightTickets"
  `
  if (
    !blockers
    || blockers.runningAttempts > 0
    || blockers.activeInvocations > 0
    || blockers.inflightTickets > 0
  ) {
    throw new Error('RECOVERY_TARGET_HAS_ACTIVE_EXTERNAL_WORK')
  }
}

async function cancelQueuedAttempts(
  transaction: postgres.TransactionSql,
  attempts: Array<{ id: string; entityType: string; entityId: string }>,
): Promise<void> {
  const ids = attempts.map(({ id }) => id)
  if (ids.length === 0) return
  await transaction`
    update task_attempts
    set status = 'cancelled',
      failure = jsonb_build_object(
        'schemaVersion', 2, 'code', 'TASK_INTERRUPTED',
        'message', '用户已停止项目执行', 'retryable', true,
        'recovery', 'restart_project'
      ),
      cancel_requested_at = now(), lease_expires_at = null,
      completed_at = now(), updated_at = now()
    where id = any(${ids}::uuid[]) and status = 'queued'
  `
  const nodeIds = attempts
    .filter(({ entityType }) => entityType === 'node')
    .map(({ entityId }) => entityId)
  if (nodeIds.length > 0) {
    await transaction`
      update canvas_nodes set status = 'cancelled', updated_at = now()
      where id = any(${nodeIds}::uuid[]) and status <> 'succeeded'
    `
  }
}

async function recoverHistoricalZombies(
  transaction: postgres.TransactionSql,
): Promise<string[]> {
  const rows = await transaction<Array<RecoveryAttemptRow>>`
    select a.id::text, a.workspace_id::text as "workspaceId", a.run_id::text as "runId",
      r.project_id::text as "projectId", a.entity_type as "entityType",
      a.entity_id::text as "entityId", a.work_unit_key as "workUnitKey"
    from task_attempts a
    join pipeline_runs r on r.workspace_id = a.workspace_id and r.id = a.run_id
    where a.status = 'running' and a.lease_expires_at is null
      and a.updated_at < now() - interval '20 minutes'
      and not exists (
        select 1 from ai_invocations i
        where i.workspace_id = a.workspace_id and i.attempt_id = a.id
          and i.status = 'running'
      )
      and not exists (
        select 1 from provider_dispatches d
        where d.workspace_id = a.workspace_id and d.attempt_id = a.id
          and d.status = 'in_flight'
      )
    for update of a skip locked
  `
  if (rows.length === 0) return []
  const ids = rows.map(({ id }) => id)
  await transaction`
    update task_attempts
    set status = 'failed',
      failure = jsonb_build_object(
        'schemaVersion', 1,
        'message', '执行进程中断，租约已过期，请重试当前阶段'
      ),
      lease_expires_at = null, completed_at = now(), updated_at = now()
    where id = any(${ids}::uuid[]) and status = 'running'
  `
  const runIds = rows.map(({ runId }) => runId)
  await transaction`
    update pipeline_runs
    set status = 'failed', completed_at = now(), updated_at = now()
    where id = any(${runIds}::uuid[]) and status = 'running'
  `
  await updateNodes(transaction, rows, 'failed')
  await releaseLeases(transaction, rows, 'expired')
  await transaction`
    update provider_dispatches
    set status = 'cancelled', released_at = now()
    where attempt_id = any(${ids}::uuid[]) and status = 'scheduled'
  `
  return ids
}

async function recoverStaleEpochs(
  transaction: postgres.TransactionSql,
): Promise<string[]> {
  const rows = await transaction<Array<RecoveryAttemptRow>>`
    select a.id::text, a.workspace_id::text as "workspaceId", a.run_id::text as "runId",
      r.project_id::text as "projectId", a.entity_type as "entityType",
      a.entity_id::text as "entityId", a.work_unit_key as "workUnitKey"
    from task_attempts a
    join pipeline_runs r on r.workspace_id = a.workspace_id and r.id = a.run_id
    join projects p on p.workspace_id = r.workspace_id and p.id = r.project_id
    where a.status = 'queued' and r.execution_epoch <> p.execution_epoch
    for update of a skip locked
  `
  if (rows.length === 0) return []
  const ids = rows.map(({ id }) => id)
  await transaction`
    update task_attempts
    set status = 'cancelled', cancel_requested_at = now(),
      failure = jsonb_build_object(
        'schemaVersion', 2, 'code', 'TASK_INTERRUPTED',
        'message', '执行代次已失效', 'retryable', true
      ),
      completed_at = now(), updated_at = now()
    where id = any(${ids}::uuid[]) and status = 'queued'
  `
  const runIds = rows.map(({ runId }) => runId)
  await transaction`
    update pipeline_runs set status = 'cancelled', completed_at = now(), updated_at = now()
    where id = any(${runIds}::uuid[]) and status in ('triggering', 'queued')
  `
  await updateNodes(transaction, rows, 'cancelled')
  await releaseLeases(transaction, rows, 'cancelled')
  await transaction`
    update provider_dispatches set status = 'cancelled', released_at = now()
    where attempt_id = any(${ids}::uuid[]) and status = 'scheduled'
  `
  return ids
}

interface RecoveryAttemptRow {
  id: string
  workspaceId: string
  runId: string
  projectId: string
  entityType: string
  entityId: string
  workUnitKey: string | null
}

async function updateNodes(
  transaction: postgres.TransactionSql,
  rows: RecoveryAttemptRow[],
  status: 'cancelled' | 'failed',
): Promise<void> {
  const nodeIds = rows
    .filter(({ entityType }) => entityType === 'node')
    .map(({ entityId }) => entityId)
  if (nodeIds.length === 0) return
  await transaction`
    update canvas_nodes set status = ${status}, updated_at = now()
    where id = any(${nodeIds}::uuid[]) and status in ('pending', 'running')
  `
}

async function releaseLeases(
  transaction: postgres.TransactionSql,
  rows: RecoveryAttemptRow[],
  status: 'cancelled' | 'expired',
): Promise<void> {
  for (const row of rows) {
    if (!row.workUnitKey) continue
    await transaction`
      update workflow_concurrency_leases
      set status = ${status}, lease_expires_at = null,
        released_at = now(), updated_at = now()
      where workspace_id = ${row.workspaceId}::uuid
        and project_id = ${row.projectId}::uuid
        and work_unit_key = ${row.workUnitKey}
        and status in ('waiting', 'active')
    `
  }
}
