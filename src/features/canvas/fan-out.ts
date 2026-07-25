import 'server-only'
import { createHash } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { getDb, LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import { canvasEdges, canvasNodes } from '@/lib/db/schema/index'
import {
  withTransaction,
  type TransactionContext,
} from '@/lib/db/transaction'
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
  shots: readonly (string | ShotLaneSeed)[]
): Promise<void> {
  const uniqueShots = deduplicateShots(shots)
  if (uniqueShots.length === 0) return

  const database = await getDb()
  await withTransaction(database, async (tx) => {
    const anchors = await findAnchors(tx, projectId)
    const existingKeys = await findExistingLaneKeys(tx, projectId, uniqueShots)

    for (const shot of uniqueShots) {
      const shotId = shot.shotId
      const existingCount = LANE_ROLES.filter((role) =>
        existingKeys.has(shotLogicalKey(shotId, role))
      ).length
      if (existingCount !== 0 && existingCount !== LANE_ROLES.length) {
        throw new Error(`分镜通道数据不完整，拒绝继续物化：${shotId}`)
      }
      if (existingCount === 0) await insertLaneNodes(tx, projectId, shot)
      await insertLaneEdges(tx, projectId, shotId, anchors)
    }
  })
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
        eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
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
        eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
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
      LANE_ROLES.map((role, index) => ({
        workspaceId: LOCAL_WORKSPACE_ID,
        id: stableId('node', projectId, shot.shotId, role),
        projectId,
        logicalKey: shotLogicalKey(shot.shotId, role),
        type: role,
        stage: LANE_STAGES[role],
        positionX: index * 260,
        positionY: 240,
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
        workspaceId: LOCAL_WORKSPACE_ID,
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
