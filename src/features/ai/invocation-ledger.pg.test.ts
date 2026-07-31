import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { runInAuthContext } from '@/lib/auth/workspace-context'
import {
  aiInvocations,
  pipelineRuns,
  projects,
  taskAttempts,
  users,
  workspaces,
} from '@/lib/db/schema'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import {
  createUnbilledInvocation,
  markProviderInvocationStarted,
  releaseUnbilledInvocation,
  settleUnbilledInvocation,
} from './invocation-ledger'

const getDbMock = vi.hoisted(() => vi.fn())
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db/client')>()
  return { ...original, getDb: getDbMock }
})

const USER_ID = '00000000-0000-4000-8000-000000000091'
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000092'
const database = {} as PgTestDatabase

beforeAll(async () => Object.assign(database, await createPgTestDatabase()))
beforeEach(async () => {
  await database.reset()
  getDbMock.mockReset()
  getDbMock.mockResolvedValue(database.db)
  await database.db.insert(users).values({
    id: USER_ID,
    email: 'ledger@example.test',
    name: 'Ledger User',
    passwordHash: 'test-only-password-hash',
  })
  await database.db.insert(workspaces).values({
    id: WORKSPACE_ID,
    slug: 'ledger',
    name: 'Ledger Workspace',
  })
})
afterAll(async () => database.close())

it('records a BYOK provider lifecycle with immutable actor attribution', async () => {
  const execution = await seedExecution()
  const invocationId = randomUUID()
  await inContext(async () => {
    await createUnbilledInvocation({
      invocationId,
      attemptId: execution.attemptId,
      invocationNo: 1,
      provider: 'gemini',
      model: 'gemini-test',
      funding: 'byok',
      capability: 'text',
      operation: 'workflow',
    })
    await markProviderInvocationStarted(invocationId)
    await settleUnbilledInvocation({
      invocationId,
      status: 'succeeded',
      usageStatus: 'reported',
      usage: {
        schemaVersion: 2,
        capability: 'text',
        kind: 'text',
        inputTokens: 7,
        outputTokens: 3,
      },
      providerDurationMs: 12,
    })
  })

  const [row] = await database.db.select().from(aiInvocations)
    .where(eq(aiInvocations.id, invocationId))
  expect(row).toMatchObject({
    actorUserId: USER_ID,
    funding: 'byok',
    telemetryVersion: 2,
    billingStatus: 'not_applicable',
    status: 'succeeded',
    providerDurationMs: 12,
  })
  expect(row?.providerStartedAt).toBeInstanceOf(Date)
  expect(row?.providerCompletedAt).toBeInstanceOf(Date)
  expect(row?.settledCnyMicros).toBeNull()
})

it('keeps a preflight release out of actual provider calls', async () => {
  const invocationId = randomUUID()
  await inContext(async () => {
    await createUnbilledInvocation({
      invocationId,
      invocationNo: 1,
      provider: 'openai-compatible-tts',
      model: 'tts-test',
      funding: 'custom',
      capability: 'tts',
      operation: 'credential-validation',
    })
    await releaseUnbilledInvocation(invocationId)
  })

  const [row] = await database.db.select().from(aiInvocations)
    .where(eq(aiInvocations.id, invocationId))
  expect(row).toMatchObject({
    actorUserId: USER_ID,
    funding: 'custom',
    status: 'cancelled',
    providerStartedAt: null,
    providerDurationMs: null,
  })
})

async function seedExecution() {
  const projectId = randomUUID()
  const runId = randomUUID()
  const attemptId = randomUUID()
  await database.db.insert(projects).values({
    workspaceId: WORKSPACE_ID,
    id: projectId,
    title: '账本测试',
    script: '',
    workflowVersion: 'test',
    exportSettings: { schemaVersion: 1, settings: {} },
  })
  await database.db.insert(pipelineRuns).values({
    workspaceId: WORKSPACE_ID,
    id: runId,
    projectId,
    requestedByUserId: USER_ID,
    status: 'running',
    workflowVersion: 'test',
    fingerprint: 'a'.repeat(64),
  })
  await database.db.insert(taskAttempts).values({
    workspaceId: WORKSPACE_ID,
    id: attemptId,
    runId,
    taskId: 'ledger.test',
    entityType: 'project',
    entityId: projectId,
    attemptNo: 1,
    status: 'running',
    fingerprint: 'b'.repeat(64),
    checkpoint: { schemaVersion: 1 },
  })
  return { attemptId }
}

function inContext<T>(operation: () => Promise<T>): Promise<T> {
  return runInAuthContext(
    { workspaceId: WORKSPACE_ID, userId: USER_ID },
    operation,
  )
}
