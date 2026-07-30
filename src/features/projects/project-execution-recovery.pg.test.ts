import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  artifacts,
  canvasNodes,
  pipelineRuns,
  projects,
  taskAttempts,
  workspaces,
} from '@/lib/db/schema'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import { WEBSITE_WORKFLOW_PHASES } from '@/features/website/website-stage-contract'
import { recoverWebsiteDelivery } from './project-execution-recovery'

vi.mock('server-only', () => ({}))

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const PROJECT_ID = '00000000-0000-4000-8000-000000000101'
const ARTIFACT_ID = '00000000-0000-4000-8000-000000000301'
let database: PgTestDatabase

beforeAll(async () => {
  database = await createPgTestDatabase()
})

beforeEach(async () => {
  await database.reset()
  await database.db.insert(workspaces).values({
    id: WORKSPACE_ID,
    slug: 'website-recovery',
    name: 'Website recovery',
  })
  await database.db.insert(projects).values({
    workspaceId: WORKSPACE_ID,
    id: PROJECT_ID,
    title: '网站介绍',
    script: '',
    workflowKind: 'website',
    workflowVersion: 'website:1.0.0',
    exportSettings: { schemaVersion: 1 },
  })
})

afterAll(async () => {
  await database.close()
})

describe('recoverWebsiteDelivery', () => {
  it('approves a verified same-attempt draft without creating another attempt', async () => {
    const attemptId = await seedTerminalDelivery(true)

    await expect(recoverWebsiteDelivery(PROJECT_ID, {
      database: database.db,
      workspaceId: WORKSPACE_ID,
    })).resolves.toBe(true)

    expect(await lifecycle()).toBe('approved')
    expect(await attemptCount()).toBe(1)
    expect(await latestAttemptId()).toBe(attemptId)
  })

  it('leaves a degraded draft blocked', async () => {
    await seedTerminalDelivery(false)

    await expect(recoverWebsiteDelivery(PROJECT_ID, {
      database: database.db,
      workspaceId: WORKSPACE_ID,
    })).resolves.toBe(false)

    expect(await lifecycle()).toBe('draft')
    expect(await attemptCount()).toBe(1)
  })
})

async function seedTerminalDelivery(passed: boolean): Promise<string> {
  const runId = randomUUID()
  const attemptId = randomUUID()
  await database.db.insert(pipelineRuns).values({
    workspaceId: WORKSPACE_ID,
    id: runId,
    projectId: PROJECT_ID,
    status: 'succeeded',
    workflowVersion: 'website:1.0.0',
    fingerprint: 'b'.repeat(64),
  })
  await database.db.insert(taskAttempts).values({
    workspaceId: WORKSPACE_ID,
    id: attemptId,
    runId,
    taskId: 'legacy.website-video',
    entityType: 'project',
    entityId: PROJECT_ID,
    attemptNo: 1,
    status: 'succeeded',
    fingerprint: 'c'.repeat(64),
    checkpoint: { schemaVersion: 1 },
  })
  await database.db.insert(canvasNodes).values(
    WEBSITE_WORKFLOW_PHASES.map((phase) => ({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      logicalKey: `website:${phase}`,
      type: 'website-stage',
      stage: phase === 'export' ? 'FINALIZE' : 'INGEST',
      status: 'succeeded' as const,
      data: {
        schemaVersion: 1,
        payload: {
          phase,
          ...(phase === 'export'
            ? {
                websiteExecution: {
                  schemaVersion: 1,
                  phase,
                  state: 'succeeded',
                  verification: {
                    checkPassed: passed,
                    goldenVerified: true,
                    goldenCheckCount: 5,
                    outcome: passed ? 'passed' : 'degraded',
                  },
                  artifact: {
                    artifactId: ARTIFACT_ID,
                    contentHash: 'a'.repeat(64),
                    sizeBytes: 2048,
                  },
                  updatedAt: '2026-07-30T00:00:00.000Z',
                },
              }
            : {}),
        },
      },
    })),
  )
  await database.db.insert(artifacts).values({
    workspaceId: WORKSPACE_ID,
    id: ARTIFACT_ID,
    projectId: PROJECT_ID,
    aggregateType: 'project',
    aggregateId: PROJECT_ID,
    kind: 'website-video-mp4',
    version: 1,
    lifecycle: 'draft',
    schemaVersion: '1',
    storageKey: `website/${PROJECT_ID}/${attemptId}/video.mp4`,
    sizeBytes: 2048,
    contentHash: 'a'.repeat(64),
    attemptId,
  })
  return attemptId
}

async function lifecycle(): Promise<string | undefined> {
  const [row] = await database.db
    .select({ lifecycle: artifacts.lifecycle })
    .from(artifacts)
    .where(eq(artifacts.id, ARTIFACT_ID))
  return row?.lifecycle
}

async function attemptCount(): Promise<number> {
  return (await database.db.select({ id: taskAttempts.id }).from(taskAttempts)).length
}

async function latestAttemptId(): Promise<string | undefined> {
  const [row] = await database.db.select({ id: taskAttempts.id }).from(taskAttempts)
  return row?.id
}
