import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { createPgTestDatabase } from './test/pg-test-database'

const TABLES = [
  'workspaces', 'projects', 'canvas_nodes', 'canvas_edges', 'pipeline_runs',
  'task_attempts', 'artifacts', 'command_receipts', 'model_routes',
  'media_routes', 'provider_credentials', 'ai_invocations',
] as const
const BUSINESS_TABLES = TABLES.filter((table) => table !== 'workspaces')
const ENUM_CHECKS = {
  projects_status_check: ['active', 'archived'],
  canvas_nodes_type_check: [
    'script-import', 'shot-split', 'score', 'export', 'shot-script',
    'shot-codegen', 'shot-sfx', 'shot-subtitle', 'shot-qa',
  ],
  canvas_nodes_stage_check: [
    'INGEST', 'DIRECT', 'SHOT_SPEC', 'FABRICATE', 'ASSEMBLE', 'FINALIZE',
  ],
  canvas_nodes_status_check: [
    'idle', 'queued', 'running', 'succeeded', 'failed', 'cancelled', 'stale',
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
] as const
const REQUIRED_UNIQUES = [
  'workspaces:slug',
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
] as const
const EXPECTED_FOREIGN_KEYS = [
  ...BUSINESS_TABLES.map((table) => `${table}->workspaces:workspace_id=>id`),
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

it('creates exactly twelve tables with workspace-scoped primary keys', async () => {
  const rows = await database.sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `
  expect(rows.map((row) => row.table_name)).toEqual([...TABLES].sort())
  const signatures = (await constraints('p')).map(constraintSignature).sort()
  const expected = [
    'workspaces:id',
    ...BUSINESS_TABLES.map((table) => `${table}:workspace_id,id`),
  ].sort()
  expect(signatures).toEqual(expected)
})

it('locks the exact set of twenty-three workspace-safe foreign keys', async () => {
  const signatures = (await foreignKeys()).map(foreignKeySignature).sort()
  expect(EXPECTED_FOREIGN_KEYS).toHaveLength(23)
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
  expect(identities).toHaveLength(23)
  expect(identities.every((row) => row.data_type === 'uuid')).toBe(true)
  const revisions = await database.sql<{ table_name: string; data_type: string }[]>`
    SELECT table_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'revision'
  `
  expect(revisions).toHaveLength(6)
  expect(revisions.every((row) => row.data_type === 'bigint')).toBe(true)
  const times = await database.sql<{ table_name: string; data_type: string }[]>`
    SELECT table_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND right(column_name, 3) = '_at'
  `
  expect(times).toHaveLength(31)
  expect(new Set(times.map((row) => row.table_name))).toEqual(new Set(TABLES))
  expect(times.every((row) => row.data_type === 'timestamp with time zone')).toBe(true)
})
