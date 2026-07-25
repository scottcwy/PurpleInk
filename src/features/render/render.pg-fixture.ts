import { randomUUID } from 'node:crypto'
import type { Db } from '@/lib/db/client'
import {
  artifacts,
  canvasNodes,
  pipelineRuns,
  projects,
  taskAttempts,
  workspaces,
} from '@/lib/db/schema/index'

export const TEST_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
export const OTHER_WORKSPACE_ID = '00000000-0000-4000-8000-000000000002'

export interface RenderFixture {
  projectId: string
  codegenNodeId: string
  qaNodeId: string
  nodeAttemptId: string
  qaAttemptId: string
  projectAttemptId: string
}

export async function seedRenderFixture(
  db: Db,
  workspaceId = TEST_WORKSPACE_ID,
  projectId: string = randomUUID()
): Promise<RenderFixture> {
  const codegenNodeId = randomUUID()
  const qaNodeId = randomUUID()
  await db
    .insert(workspaces)
    .values({
      id: workspaceId,
      slug: `render-${workspaceId}`,
      name: 'Render Test',
    })
    .onConflictDoNothing()
  await db.insert(projects).values({
    workspaceId,
    id: projectId,
    title: '渲染项目',
    script: '',
    workflowVersion: 'render-test-v1',
    exportSettings: {
      schemaVersion: 1,
      settings: { resolutionPreset: '720x1280' },
    },
  })
  await db.insert(canvasNodes).values([
    {
      workspaceId,
      id: codegenNodeId,
      projectId,
      logicalKey: 'shot:S001:shot-codegen',
      type: 'shot-codegen',
      stage: 'FABRICATE',
      status: 'succeeded',
      positionX: 0,
      positionY: 0,
      data: nodeData('S001', 'shot-codegen', {
        renderSpec: {
          fps: 30,
          durationInFrames: 60,
          width: 1920,
          height: 1080,
        },
      }),
    },
    {
      workspaceId,
      id: qaNodeId,
      projectId,
      logicalKey: 'shot:S001:shot-qa',
      type: 'shot-qa',
      stage: 'FINALIZE',
      status: 'idle',
      positionX: 260,
      positionY: 0,
      data: nodeData('S001', 'shot-qa'),
    },
  ])
  const runId = randomUUID()
  const nodeAttemptId = randomUUID()
  const qaAttemptId = randomUUID()
  const projectAttemptId = randomUUID()
  await db.insert(pipelineRuns).values({
    workspaceId,
    id: runId,
    projectId,
    status: 'running',
    workflowVersion: 'render-test-v1',
    fingerprint: 'a'.repeat(64),
  })
  await db.insert(taskAttempts).values([
    attempt(workspaceId, nodeAttemptId, runId, codegenNodeId, 'node', 1),
    attempt(workspaceId, qaAttemptId, runId, qaNodeId, 'node', 2),
    attempt(workspaceId, projectAttemptId, runId, projectId, 'project', 3),
  ])
  await insertArtifact(db, {
    workspaceId,
    projectId,
    aggregateId: codegenNodeId,
    attemptId: nodeAttemptId,
    kind: 'director-fabricate',
    storageKey: 'director/S001.html',
    contentHash: 'b'.repeat(64),
  })
  return {
    projectId,
    codegenNodeId,
    qaNodeId,
    nodeAttemptId,
    qaAttemptId,
    projectAttemptId,
  }
}

export async function insertArtifact(
  db: Db,
  input: {
    workspaceId?: string
    projectId: string
    aggregateId: string
    aggregateType?: 'node' | 'project'
    attemptId: string
    kind: string
    storageKey: string
    contentHash?: string
    version?: number
  }
): Promise<string> {
  const id = randomUUID()
  await db.insert(artifacts).values({
    workspaceId: input.workspaceId ?? TEST_WORKSPACE_ID,
    id,
    projectId: input.projectId,
    aggregateType: input.aggregateType ?? 'node',
    aggregateId: input.aggregateId,
    kind: input.kind,
    version: input.version ?? 1,
    lifecycle: 'draft',
    schemaVersion: 'cvc.render-test/v1',
    storageKey: input.storageKey,
    sizeBytes: 1,
    contentHash: input.contentHash ?? 'c'.repeat(64),
    attemptId: input.attemptId,
  })
  return id
}

function nodeData(
  laneKey: string,
  laneRole: string,
  extra: Record<string, unknown> = {}
) {
  return {
    schemaVersion: 1,
    payload: { laneKey, laneRole, ...extra },
  }
}

function attempt(
  workspaceId: string,
  id: string,
  runId: string,
  entityId: string,
  entityType: 'node' | 'project',
  attemptNo: number
) {
  return {
    workspaceId,
    id,
    runId,
    taskId: `legacy.render-${entityType}`,
    entityType,
    entityId,
    attemptNo,
    status: 'running',
    fingerprint: String(attemptNo).repeat(64),
    checkpoint: { schemaVersion: 1 },
  }
}
