import 'server-only'
import { createHash } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { currentUserId, currentWorkspaceId, SYSTEM_USER_ID } from '@/lib/auth/workspace-context'
import { registerWorkflowSlotsInTransaction } from '@/features/ai/workspace-concurrency'
import { getDb } from '@/lib/db/client'
import { canvasEdges, canvasNodes, taskAttempts } from '@/lib/db/schema/index'
import {
  assertNodeExecutionFence,
  withTransaction,
  type NodeExecutionFence,
  type TransactionContext,
} from '@/lib/db/transaction'
import { statusBus } from '@/lib/stream/status-bus'
import type { ShotLaneSeed } from './contracts'
import type { ShotLaneNodeType } from './types'

const LANE_ROLES: ShotLaneNodeType[] = [
  'shot-script',
  'shot-codegen',
  'shot-sfx',
  'shot-subtitle',
  'shot-qa',
]

const LANE_STAGES: Record<ShotLaneNodeType, string> = {
  'shot-script': 'SHOT_SPEC',
  'shot-codegen': 'FABRICATE',
  'shot-sfx': 'ASSEMBLE',
  'shot-subtitle': 'ASSEMBLE',
  'shot-qa': 'FINALIZE',
}

type AnchorType = 'shot-split' | 'score'

/** 在单个事务内幂等物化分镜通道及其首尾锚点连线。 */
export async function materializeShotLanes(
  projectId: string,
  shots: readonly (string | ShotLaneSeed)[],
  execution?: NodeExecutionFence,
): Promise<void> {
  const uniqueShots = deduplicateShots(shots)
  if (uniqueShots.length === 0) return

  const database = await getDb()
  const insertedLanes = await withTransaction(database, async (tx) => {
    if (execution) await assertMaterializationExecution(tx, projectId, execution)
    const anchors = await findAnchors(tx, projectId)
    const existingKeys = await findExistingLaneKeys(tx, projectId, uniqueShots)

    let inserted = 0
    for (const shot of uniqueShots) {
      const shotId = shot.shotId
      const existingCount = LANE_ROLES.filter((role) =>
        existingKeys.has(shotLogicalKey(shotId, role))
      ).length
      if (existingCount !== 0 && existingCount !== LANE_ROLES.length) {
        throw new Error(`分镜通道数据不完整，拒绝继续物化：${shotId}`)
      }
      if (existingCount === 0) {
        await insertLaneNodes(tx, projectId, shot)
        inserted += 1
      }
      await insertLaneEdges(tx, projectId, shotId, anchors)
    }
    const actorUserId = currentUserId()
    await registerWorkflowSlotsInTransaction(tx, {
      workspaceId: currentWorkspaceId(),
      actorUserId: actorUserId === SYSTEM_USER_ID || !isUuid(actorUserId)
        ? null
        : actorUserId,
      projectId,
      workUnitKeys: uniqueShots.map((shot) => shot.shotId),
    })
    return inserted
  })
  // 事务提交后才广播拓扑变化；幂等重放（泳道已存在）不发事件。
  if (insertedLanes > 0) {
    try {
      statusBus.publishTopology(projectId)
    } catch {
      // 推送是体验增强，不反向阻断扇出。
    }
  }
}

async function findAnchors(
  tx: TransactionContext,
  projectId: string
): Promise<Record<AnchorType, string>> {
  const nodes = await tx
    .select({ id: canvasNodes.id, type: canvasNodes.type })
    .from(canvasNodes)
    .where(
      and(
        eq(canvasNodes.workspaceId, currentWorkspaceId()),
        eq(canvasNodes.projectId, projectId),
        inArray(canvasNodes.type, ['shot-split', 'score'])
      )
    )

  return {
    'shot-split': requireSingleAnchor(nodes, 'shot-split'),
    score: requireSingleAnchor(nodes, 'score'),
  }
}

function requireSingleAnchor(
  nodes: Array<{ id: string; type: string }>,
  type: AnchorType
): string {
  const matches = nodes.filter((node) => node.type === type)
  if (matches.length !== 1) {
    throw new Error(`项目必须且只能包含一个 ${type} 节点，当前数量：${matches.length}`)
  }
  return matches[0]!.id
}

async function findExistingLaneKeys(
  tx: TransactionContext,
  projectId: string,
  shots: readonly ShotLaneSeed[]
): Promise<Set<string>> {
  const logicalKeys = shots.flatMap((shot) =>
    LANE_ROLES.map((role) => shotLogicalKey(shot.shotId, role))
  )
  const nodes = await tx
    .select({ logicalKey: canvasNodes.logicalKey })
    .from(canvasNodes)
    .where(
      and(
        eq(canvasNodes.workspaceId, currentWorkspaceId()),
        eq(canvasNodes.projectId, projectId),
        inArray(canvasNodes.logicalKey, logicalKeys)
      )
    )
  return new Set(nodes.map((node) => node.logicalKey))
}

async function insertLaneNodes(
  tx: TransactionContext,
  projectId: string,
  shot: ShotLaneSeed
): Promise<void> {
  await tx
    .insert(canvasNodes)
    .values(
      LANE_ROLES.map((role) => ({
        workspaceId: currentWorkspaceId(),
        id: stableId('node', projectId, shot.shotId, role),
        projectId,
        logicalKey: shotLogicalKey(shot.shotId, role),
        type: role,
        stage: LANE_STAGES[role],
        data: {
          schemaVersion: 1,
          payload: {
            laneKey: shot.shotId,
            laneRole: role,
            ...(shot.sourceUnit
              ? {
                  sourceUnit: shot.sourceUnit,
                  sourceUnitId: shot.sourceUnit.unitId,
                }
              : {}),
          },
        },
      }))
    )
}

function deduplicateShots(
  shots: readonly (string | ShotLaneSeed)[]
): ShotLaneSeed[] {
  const unique = new Map<string, ShotLaneSeed>()
  for (const shot of shots) {
    const normalized = typeof shot === 'string' ? { shotId: shot } : shot
    if (!unique.has(normalized.shotId)) unique.set(normalized.shotId, normalized)
  }
  return [...unique.values()]
}

async function insertLaneEdges(
  tx: TransactionContext,
  projectId: string,
  shotId: string,
  anchors: Record<AnchorType, string>
): Promise<void> {
  const nodeIds = LANE_ROLES.map((role) => stableId('node', projectId, shotId, role))
  const pairs = [
    [anchors['shot-split'], nodeIds[0]!],
    ...nodeIds.slice(0, -1).map((source, index) => [source, nodeIds[index + 1]!] as const),
    [nodeIds.at(-1)!, anchors.score],
  ]
  await tx
    .insert(canvasEdges)
    .values(
      pairs.map(([source, target]) => ({
        workspaceId: currentWorkspaceId(),
        id: stableId('edge', projectId, source, target),
        projectId,
        source,
        target,
      }))
    )
    .onConflictDoNothing()
}

function shotLogicalKey(shotId: string, role: ShotLaneNodeType): string {
  return `shot:${shotId}:${role}`
}

function stableId(kind: 'node' | 'edge', ...parts: string[]): string {
  const hex = createHash('sha256')
    .update([kind, ...parts].join('\u0000'))
    .digest('hex')
    .slice(0, 32)
    .split('')
  hex[12] = '5'
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
  const value = hex.join('')
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20),
  ].join('-')
}

async function assertMaterializationExecution(
  tx: TransactionContext,
  projectId: string,
  execution: NodeExecutionFence,
): Promise<void> {
  const [attempt] = await tx
    .select({ entityId: taskAttempts.entityId })
    .from(taskAttempts)
    .where(and(
      eq(taskAttempts.workspaceId, currentWorkspaceId()),
      eq(taskAttempts.id, execution.attemptId),
      eq(taskAttempts.entityType, 'node'),
    ))
    .limit(1)
  if (!attempt) throw new Error('STALE_ATTEMPT')
  await assertNodeExecutionFence(
    tx,
    { id: attempt.entityId, projectId },
    execution,
  )
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value)
}
