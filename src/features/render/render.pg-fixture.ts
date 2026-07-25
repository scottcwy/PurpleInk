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

export interface RenderFixtureOptions {
  /**
   * 是否写入 `director-fabricate` 产物记录 + `renderSpec`，默认 true（已渲染
   * 成功的分镜，覆盖既有场景）。传 false 还原「首次入队」的真实状态：
   * `materializeShotLanes` 播种的节点只有 `laneKey`/`laneRole`，既没有
   * `director-fabricate` 产物也没有 `renderSpec`（该字段只在 FABRICATE 成功
   * 提交后才写入，见 `stage-result.ts` FABRICATE 分支）。
   */
  withFabricateArtifact?: boolean
  /** `shot-codegen` 节点的初始状态，默认 `'succeeded'`。 */
  codegenStatus?: string
}

export async function seedRenderFixture(
  db: Db,
  workspaceId = TEST_WORKSPACE_ID,
  projectId: string = randomUUID(),
  options: RenderFixtureOptions = {}
): Promise<RenderFixture> {
  const withFabricateArtifact = options.withFabricateArtifact ?? true
  const codegenStatus = options.codegenStatus ?? 'succeeded'
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
      settings: { resolutionPreset: '1280x720' },
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
      status: codegenStatus,
      data: nodeData(
        'S001',
        'shot-codegen',
        withFabricateArtifact
          ? {
              renderSpec: {
                fps: 30,
                durationInFrames: 60,
                width: 1920,
                height: 1080,
              },
            }
          : {}
      ),
    },
    {
      workspaceId,
      id: qaNodeId,
      projectId,
      logicalKey: 'shot:S001:shot-qa',
      type: 'shot-qa',
      stage: 'FINALIZE',
      status: 'idle',
      data: nodeData('S001', 'shot-qa'),
    },
  ])
  const nodeAttemptId = randomUUID()
  const qaAttemptId = randomUUID()
  const projectAttemptId = randomUUID()
  // 生产形状是「一次入队 = 一个 pipeline_run + 一个 task_attempt」。
  // 早先把三个 attempt 塞进同一个 run，制造了生产永远产不出来的状态，
  // 也因此掩盖了缩略图必失败的缺陷（见 commitDerivedArtifact 的引入原因）。
  const runs = [
    { attemptId: nodeAttemptId, entityId: codegenNodeId, entityType: 'node' as const },
    { attemptId: qaAttemptId, entityId: qaNodeId, entityType: 'node' as const },
    { attemptId: projectAttemptId, entityId: projectId, entityType: 'project' as const },
  ]
  let attemptNo = 0
  for (const run of runs) {
    attemptNo += 1
    const runId = randomUUID()
    await db.insert(pipelineRuns).values({
      workspaceId,
      id: runId,
      projectId,
      status: 'running',
      workflowVersion: 'render-test-v1',
      fingerprint: String(attemptNo).repeat(64),
    })
    await db
      .insert(taskAttempts)
      .values(
        attempt(
          workspaceId,
          run.attemptId,
          runId,
          run.entityId,
          run.entityType,
          attemptNo
        )
      )
  }
  if (withFabricateArtifact) {
    await insertArtifact(db, {
      workspaceId,
      projectId,
      aggregateId: codegenNodeId,
      attemptId: nodeAttemptId,
      kind: 'director-fabricate',
      storageKey: 'director/S001.html',
      contentHash: 'b'.repeat(64),
    })
  }
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
