import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { createPgTestDatabase } from './test/pg-test-database'

const id = (suffix: number) =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`
const IDS = {
  workspace: id(1),
  otherWorkspace: id(2),
  project: id(11),
  otherProject: id(12),
  sourceNode: id(21),
  targetNode: id(22),
  foreignNode: id(23),
  run: id(31),
  otherRun: id(32),
  attempt: id(41),
  artifact: id(51),
  releasedArtifact: id(52),
  receipt: id(61),
  modelRoute: id(71),
  mediaRoute: id(72),
  credential: id(73),
  invocation: id(81),
  repairInvocation: id(82),
} as const

const database = {} as Awaited<ReturnType<typeof createPgTestDatabase>>

async function seedCoreAndCanvas(): Promise<void> {
  await database.sql`
    INSERT INTO workspaces (id, slug, name) VALUES
      (${IDS.workspace}, 'contract-one', 'Contract One'),
      (${IDS.otherWorkspace}, 'contract-two', 'Contract Two')
  `
  await database.sql`
    INSERT INTO projects (
      workspace_id, id, title, script, status, workflow_version, revision,
      export_settings, autopilot
    ) VALUES
      (${IDS.workspace}, ${IDS.project}, '项目一', '脚本一', 'active',
        'contract-workflow-v1', 0, '{"schemaVersion":1}'::jsonb, false),
      (${IDS.otherWorkspace}, ${IDS.otherProject}, '项目二', '脚本二', 'active',
        'contract-workflow-v1', 0, '{"schemaVersion":1}'::jsonb, false)
  `
  await database.sql`
    INSERT INTO canvas_nodes (
      workspace_id, id, project_id, logical_key, type, stage, status,
      position_x, position_y, data
    ) VALUES
      (${IDS.workspace}, ${IDS.sourceNode}, ${IDS.project}, 'source',
        'script-import', 'INGEST', 'idle', 0, 0, '{"schemaVersion":1}'::jsonb),
      (${IDS.workspace}, ${IDS.targetNode}, ${IDS.project}, 'target',
        'shot-split', 'DIRECT', 'idle', 10, 10, '{"schemaVersion":1}'::jsonb),
      (${IDS.otherWorkspace}, ${IDS.foreignNode}, ${IDS.otherProject}, 'foreign',
        'script-import', 'INGEST', 'idle', 0, 0, '{"schemaVersion":1}'::jsonb)
  `
}

async function seedExecution(): Promise<void> {
  await database.sql`
    INSERT INTO pipeline_runs (
      workspace_id, id, project_id, trigger_run_id, status, workflow_version,
      fingerprint, revision
    ) VALUES (
      ${IDS.workspace}, ${IDS.run}, ${IDS.project}, 'trigger-contract', 'queued',
      'contract-workflow-v1', repeat('a', 64), 0
    )
  `
  await database.sql`
    INSERT INTO task_attempts (
      workspace_id, id, run_id, task_id, entity_type, entity_id, attempt_no,
      status, fingerprint, checkpoint
    ) VALUES (
      ${IDS.workspace}, ${IDS.attempt}, ${IDS.run}, 'cvc.project.plan', 'project',
      ${IDS.project}, 1, 'queued', repeat('b', 64), '{"schemaVersion":1}'::jsonb
    )
  `
  await database.sql`
    INSERT INTO command_receipts (
      workspace_id, id, command, idempotency_key, fingerprint, status, result
    ) VALUES (
      ${IDS.workspace}, ${IDS.receipt}, 'run-project', 'contract-key',
      repeat('c', 64), 'pending', '{"schemaVersion":1}'::jsonb
    )
  `
}

async function seedArtifacts(): Promise<void> {
  await database.sql`
    INSERT INTO artifacts (
      workspace_id, id, project_id, aggregate_type, aggregate_id, kind, version,
      lifecycle, schema_version, storage_key, size_bytes, content_hash, attempt_id
    ) VALUES
      (${IDS.workspace}, ${IDS.artifact}, ${IDS.project}, 'project', ${IDS.project},
        'plan', 1, 'draft', 'cvc.project-plan/v1', 'artifact/plan-1', 1,
        repeat('d', 64), ${IDS.attempt}),
      (${IDS.workspace}, ${IDS.releasedArtifact}, ${IDS.project}, 'project',
        ${IDS.project}, 'export', 1, 'released', 'cvc.export/v1',
        'artifact/export-1', 1, repeat('e', 64), ${IDS.attempt})
  `
}

async function seedRoutesAndCredentials(): Promise<void> {
  await database.sql`
    INSERT INTO provider_credentials (
      workspace_id, id, provider, envelope_version, ciphertext, nonce, auth_tag,
      key_version, verified_at
    ) VALUES (
      ${IDS.workspace}, ${IDS.credential}, 'contract-provider', 1,
      decode('00', 'hex'), decode(repeat('00', 12), 'hex'),
      decode(repeat('00', 16), 'hex'), '1', now()
    )
  `
  await database.sql`
    INSERT INTO model_routes (
      workspace_id, id, ai_task_kind, provider, model, revision
    ) VALUES (
      ${IDS.workspace}, ${IDS.modelRoute}, 'project-plan', 'contract-provider',
      'contract-model', 0
    )
  `
  await database.sql`
    INSERT INTO media_routes (
      workspace_id, id, media_task_kind, provider, model, revision
    ) VALUES (
      ${IDS.workspace}, ${IDS.mediaRoute}, 'tts', 'contract-provider',
      'contract-media-model', 0
    )
  `
}

async function seedInvocations(): Promise<void> {
  await database.sql`
    INSERT INTO ai_invocations (
      workspace_id, id, run_id, attempt_id, task_id, invocation_no, repair_no,
      status, provider, model, input_hash
    ) VALUES
      (${IDS.workspace}, ${IDS.invocation}, ${IDS.run}, ${IDS.attempt},
        'cvc.project.plan', 1, 0, 'running', 'contract-provider',
        'contract-model', repeat('f', 64)),
      (${IDS.workspace}, ${IDS.repairInvocation}, ${IDS.run}, ${IDS.attempt},
        'cvc.project.plan', 1, 1, 'running', 'contract-provider',
        'contract-model', repeat('f', 64))
  `
}

async function seedAll(): Promise<void> {
  await seedCoreAndCanvas()
  await seedExecution()
  await seedArtifacts()
  await seedRoutesAndCredentials()
  await seedInvocations()
}

beforeAll(async () => Object.assign(database, await createPgTestDatabase()))
beforeEach(async () => database.reset())
afterAll(async () => database.close())

it('rejects invalid lifecycle, route, attempt, and revision values', async () => {
  await seedAll()
  const invalidStatements = [
    database.sql`UPDATE projects SET status = 'invalid' WHERE id = ${IDS.project}`,
    database.sql`UPDATE canvas_nodes SET type = 'invalid' WHERE id = ${IDS.sourceNode}`,
    database.sql`UPDATE canvas_nodes SET stage = 'invalid' WHERE id = ${IDS.sourceNode}`,
    database.sql`UPDATE canvas_nodes SET status = 'invalid' WHERE id = ${IDS.sourceNode}`,
    database.sql`UPDATE pipeline_runs SET status = 'invalid' WHERE id = ${IDS.run}`,
    database.sql`UPDATE task_attempts SET status = 'invalid' WHERE id = ${IDS.attempt}`,
    database.sql`UPDATE task_attempts SET attempt_no = 0 WHERE id = ${IDS.attempt}`,
    database.sql`UPDATE artifacts SET lifecycle = 'invalid' WHERE id = ${IDS.artifact}`,
    database.sql`UPDATE command_receipts SET status = 'invalid' WHERE id = ${IDS.receipt}`,
    database.sql`UPDATE model_routes SET ai_task_kind = 'tts' WHERE id = ${IDS.modelRoute}`,
    database.sql`UPDATE model_routes SET revision = -1 WHERE id = ${IDS.modelRoute}`,
    database.sql`UPDATE media_routes SET media_task_kind = 'vision-qa' WHERE id = ${IDS.mediaRoute}`,
    database.sql`UPDATE media_routes SET revision = -1 WHERE id = ${IDS.mediaRoute}`,
    database.sql`UPDATE ai_invocations SET repair_no = 3 WHERE id = ${IDS.invocation}`,
  ]
  for (const statement of invalidStatements) {
    await expect(statement).rejects.toThrow(/check constraint/i)
  }
})

it('prevents cross-project edges and freezes approved or released artifacts', async () => {
  await seedAll()
  await expect(database.sql`
    INSERT INTO canvas_edges (workspace_id, id, project_id, source, target)
    VALUES (
      ${IDS.workspace}, '00000000-0000-4000-8000-000000000099',
      ${IDS.project}, ${IDS.sourceNode}, ${IDS.foreignNode}
    )
  `).rejects.toThrow(/foreign key constraint/i)
  await database.sql`
    UPDATE artifacts SET lifecycle = 'approved' WHERE id = ${IDS.artifact}
  `
  for (const artifactId of [IDS.artifact, IDS.releasedArtifact]) {
    await expect(database.sql`
      UPDATE artifacts SET storage_key = 'artifact/tampered' WHERE id = ${artifactId}
    `).rejects.toThrow()
    await expect(database.sql`
      DELETE FROM artifacts WHERE id = ${artifactId}
    `).rejects.toThrow()
  }
})

it('keeps each initial or repair provider round unique', async () => {
  await seedAll()
  await expect(database.sql`
    UPDATE ai_invocations SET repair_no = 0 WHERE id = ${IDS.repairInvocation}
  `).rejects.toThrow(/unique constraint/i)
})

it('creates a triggering run before dispatch and fences the returned handle', async () => {
  await seedCoreAndCanvas()
  await database.sql`
    INSERT INTO pipeline_runs (
      workspace_id, id, project_id, status, workflow_version, fingerprint
    ) VALUES (
      ${IDS.workspace}, ${IDS.run}, ${IDS.project}, 'triggering',
      'contract-workflow-v1', repeat('a', 64)
    )
  `
  await database.sql`
    UPDATE pipeline_runs SET trigger_run_id = 'trigger-contract'
    WHERE workspace_id = ${IDS.workspace} AND id = ${IDS.run}
  `
  await expect(database.sql`
    INSERT INTO pipeline_runs (
      workspace_id, id, project_id, trigger_run_id, status, workflow_version,
      fingerprint
    ) VALUES (
      ${IDS.workspace}, ${IDS.otherRun}, ${IDS.project}, 'trigger-contract',
      'triggering', 'contract-workflow-v1', repeat('b', 64)
    )
  `).rejects.toThrow(/unique constraint/i)
})
