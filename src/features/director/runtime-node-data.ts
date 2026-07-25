import { z } from 'zod'
import type { NodeStatus } from '@/features/canvas'

const versionedNodeDataSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    payload: z.record(z.string(), z.unknown()),
  })
  .passthrough()

export function readNodePayload(data: unknown): Record<string, unknown> {
  return versionedNodeDataSchema.parse(data).payload
}

export function patchNodePayload(
  data: unknown,
  patch: Record<string, unknown>
): { schemaVersion: number; payload: Record<string, unknown> } {
  const parsed = versionedNodeDataSchema.parse(data)
  return {
    schemaVersion: parsed.schemaVersion,
    payload: { ...parsed.payload, ...patch },
  }
}

export function readLaneKey(data: unknown): string | null {
  const laneKey = readNodePayload(data).laneKey
  return typeof laneKey === 'string' && laneKey.length > 0 ? laneKey : null
}

export function fromPersistedNodeStatus(status: string): NodeStatus {
  if (status === 'queued') return 'pending'
  if (status === 'succeeded') return 'success'
  if (
    status === 'idle' ||
    status === 'running' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'stale'
  ) {
    return status
  }
  throw new Error(`未知节点状态：${status}`)
}
