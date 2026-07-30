import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { createPgTestDatabase } from './test/pg-test-database'

const TABLES = [
  'workspaces', 'projects', 'canvas_nodes', 'canvas_edges', 'pipeline_runs',
  'task_attempts', 'artifacts', 'command_receipts', 'model_routes',
  'media_routes', 'provider_credentials', 'ai_invocations', 'workspace_settings',
  'provider_dispatches',
  'provider_dispatch_cooldowns',
  'provider_pool_states', 'workflow_concurrency_leases',
  'users', 'workspace_members', 'sessions', 'email_verification_codes',
  'auth_throttle', 'managed_model_catalog', 'rate_cards', 'rate_card_units',
  'workspace_entitlements', 'usage_periods', 'redemption_batches',
  'redemption_codes', 'redemption_audits', 'telemetry_cutovers',
  'project_sources', 'render_jobs',
] as const
const WORKSPACE_TABLES = [
  'projects', 'canvas_nodes', 'canvas_edges', 'pipeline_runs', 'task_attempts',
  'artifacts', 'command_receipts', 'model_routes', 'media_routes',
  'provider_credentials', 'ai_invocations', 'workspace_settings',
  'usage_periods', 'workspace_entitlements', 'workflow_concurrency_leases',
  'project_sources',
] as const
const ENUM_CHECKS = {
  projects_status_check: ['active', 'archived'],
  projects_workflow_kind_check: ['script', 'audio', 'website'],
  project_sources_kind_check: ['script', 'audio', 'website'],
  canvas_nodes_type_check: [
    'script-import', 'shot-split', 'score', 'export', 'shot-script',
    'shot-codegen', 'shot-sfx', 'shot-subtitle', 'shot-qa',
    'audio-transcribe', 'website-stage',
  ],
  canvas_nodes_stage_check: [
    'INGEST', 'DIRECT', 'SHOT_SPEC', 'FABRICATE', 'ASSEMBLE', 'FINALIZE',
  ],
  canvas_nodes_status_check: [
    'idle', 'queued', 'running', 'succeeded', 'failed', 'cancelled', 'stale',
    'skipped', 'blocked',
  ],
  pipeline_runs_status_check: [
    'triggering', 'queued', 'running', 'succeeded', 'failed', 'cancelled',
  ],
  task_attempts_status_check: [
    'queued', 'running', 'succeeded', 'failed', 'cancelled', 'superseded',
  ],
  artifacts_lifecycle_check: ['draft', 'approved', 'released', 'rejected'],
  command_receipts_status_check: ['pending', 'succeeded', 'failed'],
  model_routes_ai_task_kind_check: [
    'project-plan', 'shot-spec', 'fabricate', 'vision-qa',
  ],
  media_routes_media_task_kind_check: ['tts', 'asr'],
  ai_invocations_status_check: ['running', 'succeeded', 'failed', 'cancelled'],
  ai_invocations_funding_check: ['managed', 'byok', 'custom'],
  ai_invocations_capability_check: ['text', 'vision', 'tts', 'asr', 'workflow'],
  ai_invocations_billing_status_check: [
    'unreserved', 'reserved', 'settled', 'released', 'not_applicable',
  ],
  rate_card_units_kind_check: [
    'input_token', 'cached_input_token', 'output_token',
    'tts_character', 'audio_second', 'video_second',
  ],
  provider_dispatches_funding_check: ['managed', 'byok'],
  provider_dispatches_status_check: ['reserved', 'released'],
  workflow_concurrency_leases_status_check: [
    'waiting', 'active', 'released', 'cancelled', 'expired',
  ],
  users_status_check: ['active', 'disabled'],
  users_role_check: ['user', 'admin'],
  workspace_members_role_check: ['owner', 'member'],
  render_jobs_status_check: ['queued', 'running', 'done', 'failed'],
  render_jobs_kind_check: ['url', 'capture'],
  email_verification_codes_purpose_check: ['signup', 'password_reset'],
} as const
const NUMERIC_CHECKS = [
  'projects_revision_check', 'canvas_nodes_revision_check',
  'pipeline_runs_revision_check', 'task_attempts_attempt_no_check',
  'task_attempts_revision_check', 'artifacts_version_check',
  'artifacts_size_bytes_check', 'model_routes_revision_check',
  'media_routes_revision_check', 'provider_credentials_envelope_version_check',
  'provider_credentials_nonce_length_check',
  'provider_credentials_auth_tag_length_check',
  'ai_invocations_invocation_no_check', 'ai_invocations_repair_no_check',
  'ai_invocations_telemetry_version_check',
  'ai_invocations_provider_duration_check',
  'provider_dispatches_token_estimate_check',
  'provider_pool_states_current_concurrency_check',
  'provider_pool_states_max_concurrency_check',
  'email_verification_codes_attempt_check', 'auth_throttle_count_check',
] as const
const REQUIRED_UNIQUES = [
  'workspaces:slug',
  'projects:workspace_id,id,workflow_kind',
  'canvas_nodes:workspace_id,project_id,logical_key',
  'canvas_nodes:workspace_id,project_id,id',
  'canvas_edges:workspace_id,project_id,source,target',
  'pipeline_runs:workspace_id,trigger_run_id',
  'task_attempts:workspace_id,run_id,task_id,entity_type,entity_id,attempt_no',
  'artifacts:workspace_id,aggregate_type,aggregate_id,kind,version',
  'artifacts:workspace_id,project_id,id',
  'command_receipts:workspace_id,idempotency_key',
  'model_routes:workspace_id,ai_task_kind',
  'media_routes:workspace_id,media_task_kind',
  'provider_credentials:workspace_id,provider',
  'ai_invocations:workspace_id,attempt_id,invocation_no,repair_no',
  'ai_invocations:workspace_id,billing_idempotency_key',
  'managed_model_catalog:provider,model,capability',
  'rate_cards:catalog_id,version',
  'redemption_audits:workspace_id,idempotency_key',
  'redemption_codes:code_hash',
  'usage_periods:workspace_id,starts_at',
  'sessions:token_hash',
] as const
const EXPECTED_FOREIGN_KEYS = [
  ...WORKSPACE_TABLES.map((table) => `${table}->workspaces:workspace_id=>id`),
  'provider_dispatches->workspaces:workspace_id=>id',
  'workflow_concurrency_leases->projects:workspace_id,project_id=>workspace_id,id',
  'project_sources->projects:workspace_id,project_id,kind=>workspace_id,id,workflow_kind',
  'workflow_concurrency_leases->users:actor_user_id=>id',
  'canvas_nodes->projects:workspace_id,project_id=>workspace_id,id',
  'canvas_edges->projects:workspace_id,project_id=>workspace_id,id',
  'canvas_edges->canvas_nodes:workspace_id,project_id,source=>workspace_id,project_id,id',
  'canvas_edges->canvas_nodes:workspace_id,project_id,target=>workspace_id,project_id,id',
  'pipeline_runs->projects:workspace_id,project_id=>workspace_id,id',
  'task_attempts->pipeline_runs:workspace_id,run_id=>workspace_id,id',
  'artifacts->projects:workspace_id,project_id=>workspace_id,id',
  'artifacts->task_attempts:workspace_id,attempt_id=>workspace_id,id',
  'artifacts->artifacts:workspace_id,project_id,supersedes_artifact_id=>workspace_id,project_id,id',
  'ai_invocations->pipeline_runs:workspace_id,run_id=>workspace_id,id',
  'ai_invocations->task_attempts:workspace_id,attempt_id=>workspace_id,id',
  'ai_invocations->artifacts:workspace_id,trace_artifact_id=>workspace_id,id',
  'ai_invocations->rate_cards:rate_card_id=>id',
  'ai_invocations->usage_periods:workspace_id,usage_period_id=>workspace_id,id',
  'ai_invocations->users:actor_user_id=>id',
  'pipeline_runs->users:requested_by_user_id=>id',
  'rate_card_units->rate_cards:rate_card_id=>id',
  'rate_cards->managed_model_catalog:catalog_id=>id',
  'redemption_audits->redemption_codes:code_id=>id',
  'redemption_audits->users:actor_user_id=>id',
  'redemption_audits->workspaces:workspace_id=>id',
  'redemption_batches->users:created_by_user_id=>id',
  'redemption_codes->redemption_batches:batch_id=>id',
  'redemption_codes->workspaces:consumed_by_workspace_id=>id',
  'workspace_members->workspaces:workspace_id=>id',
  'workspace_members->users:user_id=>id',
  'sessions->workspaces:workspace_id=>id',
  'sessions->users:user_id=>id',
] as const

interface ConstraintRow {
  table_name: string
  columns: string[]
}
interface ForeignKeyRow extends ConstraintRow {
  target_table: string
  target_columns: string[]
}
interface CheckRow {
  name: string
  definition: string
}
const database = {} as Awaited<ReturnType<typeof createPgTestDatabase>>

async function constraints(type: 'p' | 'u'): Promise<ConstraintRow[]> {
  return database.sql<ConstraintRow[]>`
    SELECT source_table.relname AS table_name,
      array_agg(attribute.attname ORDER BY key_column.ordinality)::text[] AS columns
    FROM pg_constraint AS constraint_record
    JOIN pg_class AS source_table ON source_table.oid = constraint_record.conrelid
    JOIN pg_namespace AS source_schema ON source_schema.oid = source_table.relnamespace
    CROSS JOIN LATERAL unnest(constraint_record.conkey)
      WITH ORDINALITY AS key_column(attnum, ordinality)
    JOIN pg_attribute AS attribute
      ON attribute.attrelid = constraint_record.conrelid
      AND attribute.attnum = key_column.attnum
    WHERE constraint_record.contype = ${type} AND source_schema.nspname = 'public'
    GROUP BY source_table.relname, constraint_record.conname
  `
}

async function foreignKeys(): Promise<ForeignKeyRow[]> {
  return database.sql<ForeignKeyRow[]>`
    SELECT source_table.relname AS table_name, target_table.relname AS target_table,
      array_agg(source_attribute.attname ORDER BY pair.ordinality)::text[] AS columns,
      array_agg(target_attribute.attname ORDER BY pair.ordinality)::text[]
        AS target_columns
    FROM pg_constraint AS constraint_record
    JOIN pg_class AS source_table ON source_table.oid = constraint_record.conrelid
    JOIN pg_namespace AS source_schema ON source_schema.oid = source_table.relnamespace
    JOIN pg_class AS target_table ON target_table.oid = constraint_record.confrelid
    CROSS JOIN LATERAL unnest(constraint_record.conkey, constraint_record.confkey)
      WITH ORDINALITY AS pair(source_attnum, target_attnum, ordinality)
    JOIN pg_attribute AS source_attribute
      ON source_attribute.attrelid = constraint_record.conrelid
      AND source_attribute.attnum = pair.source_attnum
    JOIN pg_attribute AS target_attribute
      ON target_attribute.attrelid = constraint_record.confrelid
      AND target_attribute.attnum = pair.target_attnum
    WHERE constraint_record.contype = 'f' AND source_schema.nspname = 'public'
    GROUP BY source_table.relname, target_table.relname, constraint_record.conname
  `
}

function constraintSignature(row: ConstraintRow): string {
  return `${row.table_name}:${row.columns.join(',')}`
}

function foreignKeySignature(row: ForeignKeyRow): string {
  return `${row.table_name}->${row.target_table}:${row.columns.join(',')}=>${row.target_columns.join(',')}`
}

function quotedValues(definition: string): string[] {
  return [...definition.matchAll(/'([^']+)'(?:::text)?/g)]
    .map((match) => match[1])
}

beforeAll(async () => Object.assign(database, await createPgTestDatabase()))
beforeEach(async () => database.reset())
afterAll(async () => database.close())

it('creates the complete schema with scoped primary keys', async () => {
  const rows = await database.sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `
  expect(rows.map((row) => row.table_name)).toEqual([...TABLES].sort())
  const signatures = (await constraints('p')).map(constraintSignature).sort()
  const expected = [
    'workspaces:id',
    ...WORKSPACE_TABLES
      .filter((table) => ![
        'project_sources',
        'workspace_settings',
        'workspace_entitlements',
        'workflow_concurrency_leases',
      ].includes(table))
      .map((table) => `${table}:workspace_id,id`),
    'project_sources:workspace_id,project_id',
    'workspace_settings:workspace_id,key',
    'workspace_entitlements:workspace_id',
    'managed_model_catalog:id',
    'provider_dispatches:id',
    'provider_dispatch_cooldowns:scope_key',
    'provider_pool_states:scope_key',
    'workflow_concurrency_leases:workspace_id,work_unit_key',
    'rate_cards:id',
    'rate_card_units:rate_card_id,unit_kind',
    'redemption_batches:id',
    'redemption_codes:id',
    'redemption_audits:id',
    'users:id',
    'workspace_members:workspace_id,user_id',
    'sessions:id',
    'email_verification_codes:id',
    'auth_throttle:key',
    'telemetry_cutovers:key',
    'render_jobs:id',
  ].sort()
  expect(signatures).toEqual(expected)
})

it('locks the exact workspace and identity foreign keys', async () => {
  const signatures = (await foreignKeys()).map(foreignKeySignature).sort()
  expect(EXPECTED_FOREIGN_KEYS).toHaveLength(48)
  expect(signatures).toEqual([...EXPECTED_FOREIGN_KEYS].sort())
})

it('locks every required unique signature', async () => {
  const signatures = (await constraints('u')).map(constraintSignature).sort()
  expect(signatures).toEqual([...REQUIRED_UNIQUES].sort())
})

it('defines exact named enum checks and all named numeric fences', async () => {
  const checks = await database.sql<CheckRow[]>`
    SELECT constraint_record.conname AS name,
      pg_get_constraintdef(constraint_record.oid) AS definition
    FROM pg_constraint AS constraint_record
    JOIN pg_namespace AS schema_record
      ON schema_record.oid = constraint_record.connamespace
    WHERE constraint_record.contype = 'c' AND schema_record.nspname = 'public'
  `
  for (const [name, values] of Object.entries(ENUM_CHECKS)) {
    const check = checks.find((row) => row.name === name)
    expect(check, `missing ${name}`).toBeDefined()
    expect(new Set(quotedValues(check?.definition ?? ''))).toEqual(new Set(values))
  }
  const names = checks.map((row) => row.name)
  for (const name of NUMERIC_CHECKS) {
    expect(names, `missing ${name}`).toContain(name)
  }
})

it('keeps route inventories secret-free and credentials free of plaintext', async () => {
  const columns = await database.sql<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('model_routes', 'media_routes', 'provider_credentials')
  `
  const routeNames = columns
    .filter((row) => row.table_name !== 'provider_credentials')
    .map((row) => row.column_name)
  expect(routeNames.some((name) => /secret|key|ciphertext|nonce|auth_tag/i.test(name)))
    .toBe(false)
  const credentialNames = columns
    .filter((row) => row.table_name === 'provider_credentials')
    .map((row) => row.column_name)
  expect(credentialNames).toEqual(expect.arrayContaining([
    'workspace_id', 'id', 'provider', 'envelope_version', 'ciphertext', 'nonce',
    'auth_tag', 'key_version', 'verified_at', 'created_at', 'updated_at',
  ]))
  expect(credentialNames.some((name) =>
    /plaintext|secret|api_key|access_token/i.test(name))).toBe(false)
})

it('uses UUID identities, bigint revisions, and timestamptz suffixes', async () => {
  const identities = await database.sql<{ table_name: string; data_type: string }[]>`
    SELECT table_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name IN ('id', 'workspace_id')
  `
  // render_jobs 只有 id（worker 侧生成的 uuid），无 workspace_id。
  expect(identities).toHaveLength(43)
  expect(identities.every((row) => row.data_type === 'uuid')).toBe(true)
  const revisions = await database.sql<{ table_name: string; data_type: string }[]>`
    SELECT table_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'revision'
  `
  expect(revisions).toHaveLength(7)
  expect(revisions.every((row) => row.data_type === 'bigint')).toBe(true)
  const times = await database.sql<{ table_name: string; data_type: string }[]>`
    SELECT table_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND right(column_name, 3) = '_at'
  `
  // 0005 迁移给 task_attempts 增加 lease_expires_at / visible_at 两列。
  // 0019 新增 render_jobs（created_at / updated_at 两列）。
  expect(times).toHaveLength(86)
  expect(new Set(times.map((row) => row.table_name))).toEqual(
    new Set(TABLES.filter((table) => table !== 'rate_card_units')),
  )
  expect(times.every((row) => row.data_type === 'timestamp with time zone')).toBe(true)
})
