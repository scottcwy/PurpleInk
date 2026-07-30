import 'server-only'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  fromPersistedStatus,
  isNodeStatusTransitionAllowed,
  patchPayload,
  resolveTransitionData,
  toPersistedStatus,
  type NodeStatus,
} from '@/features/canvas'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb, type Db } from '@/lib/db/client'
import { artifacts, canvasNodes } from '@/lib/db/schema'
import { statusBus } from '@/lib/stream/status-bus'
import {
  WEBSITE_WORKFLOW_PHASES,
  websiteNodeTransitionPlan,
  type PersistedWebsiteNodeStatus,
  type WebsiteExecutionFailureCode,
  type WebsiteOutputProjection,
  type WebsiteStageProgress,
  type WebsiteStageProjector,
  type WebsiteStageTarget,
  type WebsiteWorkflowPhase,
} from './website-stage-contract'

const versionedNodeDataSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    payload: z.record(z.string(), z.unknown()),
  })
  .passthrough()

interface WebsiteStageNode {
  id: string
  logicalKey: string
  status: PersistedWebsiteNodeStatus
  data: unknown
}

interface WebsiteStageMutation {
  target: WebsiteStageTarget
  projection: StageExecutionProjection
}

interface StageExecutionProjection {
  schemaVersion: 1
  phase: WebsiteWorkflowPhase
  state: 'idle' | 'queued' | 'running' | 'succeeded' | 'blocked' | 'failed' | 'cancelled'
  updatedAt: string
  enginePhase?: WebsiteStageProgress['enginePhase']
  durationSec?: number | null
  durationSource?: WebsiteStageProgress['durationSource']
  elapsedSec?: number | null
  verification?: WebsiteStageProgress['verification']
  artifact?: {
    artifactId: string
    contentHash: string
    sizeBytes: number
  }
  failure?: { code: WebsiteExecutionFailureCode }
}

export class PostgresWebsiteStageProjector implements WebsiteStageProjector {
  constructor(
    private readonly database: Db,
    private readonly workspaceId: string,
  ) {}

  async progress(
    projectId: string,
    progress: WebsiteStageProgress,
  ): Promise<void> {
    const activeIndex = WEBSITE_WORKFLOW_PHASES.indexOf(progress.phase)
    const updatedAt = new Date().toISOString()
    const mutations = new Map<string, WebsiteStageMutation>()
    for (const [index, phase] of WEBSITE_WORKFLOW_PHASES.entries()) {
      mutations.set(
        `website:${phase}`,
        index < activeIndex
          ? {
            target: 'success',
            projection: succeededProjection(phase, updatedAt),
          }
          : index === activeIndex
            ? {
            target: progress.state === 'queued' ? 'pending' : 'running',
            projection: {
              schemaVersion: 1,
              phase,
              state: progress.state,
              enginePhase: progress.enginePhase,
              durationSec: progress.durationSec,
              durationSource: progress.durationSource,
              elapsedSec: progress.elapsedSec,
              verification: progress.verification,
              updatedAt,
            },
          }
            : {
                target: 'reset',
                projection: {
                  schemaVersion: 1,
                  phase,
                  state: 'idle',
                  updatedAt,
                },
              },
      )
    }
    await this.commit(projectId, mutations)
  }

  async block(
    projectId: string,
    output: WebsiteOutputProjection,
  ): Promise<void> {
    const updatedAt = new Date().toISOString()
    const mutations = new Map<string, WebsiteStageMutation>(
      WEBSITE_WORKFLOW_PHASES.map((phase) => [
        `website:${phase}`,
        {
          target: phase === 'export' ? 'failed' as const : 'success' as const,
          projection: phase === 'export'
            ? {
                schemaVersion: 1,
                phase,
                state: 'blocked',
                enginePhase: 'done',
                durationSec: output.durationSec,
                durationSource: output.durationSource,
                elapsedSec: output.elapsedSec,
                verification: output.verification,
                artifact: {
                  artifactId: output.artifactId,
                  contentHash: output.contentHash,
                  sizeBytes: output.sizeBytes,
                },
                failure: { code: 'WEBSITE_VERIFICATION_FAILED' },
                updatedAt,
              }
            : phase === 'render'
              ? {
                  ...succeededProjection(phase, updatedAt),
                  verification: output.verification,
                }
              : succeededProjection(phase, updatedAt),
        },
      ]),
    )
    await this.commit(projectId, mutations, {
      artifactId: output.artifactId,
      lifecycle: 'rejected',
    })
  }

  async complete(
    projectId: string,
    output: WebsiteOutputProjection,
  ): Promise<void> {
    const updatedAt = new Date().toISOString()
    const mutations = new Map<string, WebsiteStageMutation>(
      WEBSITE_WORKFLOW_PHASES.map((phase) => [
      `website:${phase}`,
      {
        target: 'success' as const,
        projection: phase === 'export'
          ? {
              ...succeededProjection(phase, updatedAt),
              enginePhase: 'done',
              durationSec: output.durationSec,
              durationSource: output.durationSource,
              elapsedSec: output.elapsedSec,
              verification: output.verification,
              artifact: {
                artifactId: output.artifactId,
                contentHash: output.contentHash,
                sizeBytes: output.sizeBytes,
              },
            }
          : phase === 'render'
            ? {
                ...succeededProjection(phase, updatedAt),
                verification: output.verification,
              }
          : succeededProjection(phase, updatedAt),
      },
      ]),
    )
    await this.commit(projectId, mutations, {
      artifactId: output.artifactId,
      lifecycle: 'approved',
    })
  }

  async fail(
    projectId: string,
    phase: WebsiteWorkflowPhase,
    code: WebsiteExecutionFailureCode,
  ): Promise<void> {
    const activeIndex = WEBSITE_WORKFLOW_PHASES.indexOf(phase)
    const updatedAt = new Date().toISOString()
    const mutations = new Map<string, WebsiteStageMutation>()
    for (const [index, nodePhase] of WEBSITE_WORKFLOW_PHASES.entries()) {
      const state = index < activeIndex
        ? 'succeeded'
        : index === activeIndex
          ? 'failed'
          : 'cancelled'
      mutations.set(`website:${nodePhase}`, {
        target: index < activeIndex
          ? 'success'
          : index === activeIndex ? 'failed' : 'cancelled',
        projection: {
          schemaVersion: 1,
          phase: nodePhase,
          state,
          ...(index === activeIndex ? { failure: { code } } : {}),
          updatedAt,
        },
      })
    }
    await this.commit(projectId, mutations)
  }

  private async commit(
    projectId: string,
    mutations: ReadonlyMap<string, WebsiteStageMutation>,
    artifactTransition?: {
      artifactId: string
      lifecycle: 'approved' | 'rejected'
    },
  ): Promise<void> {
    const events = await this.database.transaction(async (transaction) => {
      const rows = await transaction
        .select({
          id: canvasNodes.id,
          logicalKey: canvasNodes.logicalKey,
          status: canvasNodes.status,
          data: canvasNodes.data,
        })
        .from(canvasNodes)
        .where(and(
          eq(canvasNodes.workspaceId, this.workspaceId),
          eq(canvasNodes.projectId, projectId),
          eq(canvasNodes.type, 'website-stage'),
        ))
        .for('update')
      const byKey = new Map(rows.map((row) => [row.logicalKey, row]))
      const statusEvents: Array<{ nodeId: string; status: NodeStatus }> = []
      for (const phase of WEBSITE_WORKFLOW_PHASES) {
        const logicalKey = `website:${phase}`
        const mutation = mutations.get(logicalKey)
        if (!mutation) continue
        const row = byKey.get(logicalKey)
        if (!row || !isPersistedStatus(row.status)) {
          throw new Error(`网站工作流阶段缺失：${phase}`)
        }
        const node: WebsiteStageNode = { ...row, status: row.status }
        const resolved = resolveNodeMutation(node, mutation)
        await transaction
          .update(canvasNodes)
          .set({
            status: toPersistedStatus(resolved.status),
            data: resolved.data,
            updatedAt: new Date(),
          })
          .where(and(
            eq(canvasNodes.workspaceId, this.workspaceId),
            eq(canvasNodes.id, row.id),
          ))
        if (resolved.changed) {
          statusEvents.push({ nodeId: row.id, status: resolved.status })
        }
      }
      if (artifactTransition) {
        const [updated] = await transaction
          .update(artifacts)
          .set({
            lifecycle: artifactTransition.lifecycle,
            updatedAt: new Date(),
          })
          .where(and(
            eq(artifacts.workspaceId, this.workspaceId),
            eq(artifacts.projectId, projectId),
            eq(artifacts.id, artifactTransition.artifactId),
            eq(artifacts.lifecycle, 'draft'),
          ))
          .returning({ id: artifacts.id })
        if (!updated) {
          throw new Error('网站视频 Artifact 终态不一致')
        }
      }
      return statusEvents
    })
    for (const event of events) {
      try {
        statusBus.publishStatus(projectId, event.nodeId, event.status)
      } catch {
        // 推送仅用于体验增强，不反向破坏已提交的原子投影。
      }
    }
  }
}

export async function createWebsiteStageProjector(): Promise<WebsiteStageProjector> {
  return new PostgresWebsiteStageProjector(
    await getDb(),
    currentWorkspaceId(),
  )
}

function resolveNodeMutation(
  node: WebsiteStageNode,
  mutation: WebsiteStageMutation,
): { status: NodeStatus; data: z.infer<typeof versionedNodeDataSchema>; changed: boolean } {
  let status = fromPersistedStatus(node.status)
  let data = versionedNodeDataSchema.parse(node.data)
  const transitions = websiteNodeTransitionPlan(node.status, mutation.target)
  for (const next of transitions) {
    if (!isNodeStatusTransitionAllowed(status, next)) {
      throw new Error(`非法网站节点状态转换：${status} -> ${next}`)
    }
    data = versionedNodeDataSchema.parse(resolveTransitionData(
      data,
      status,
      next,
      undefined,
      undefined,
      undefined,
    ) ?? data)
    status = next
  }
  data = versionedNodeDataSchema.parse(patchPayload(data, {
    websiteExecution: mutation.projection,
  }))
  return { status, data, changed: transitions.length > 0 }
}

function succeededProjection(
  phase: WebsiteWorkflowPhase,
  updatedAt: string,
): StageExecutionProjection {
  return { schemaVersion: 1, phase, state: 'succeeded', updatedAt }
}

function isPersistedStatus(value: string): value is PersistedWebsiteNodeStatus {
  return [
    'idle', 'queued', 'running', 'succeeded', 'failed',
    'cancelled', 'stale', 'skipped', 'blocked',
  ].includes(value)
}
