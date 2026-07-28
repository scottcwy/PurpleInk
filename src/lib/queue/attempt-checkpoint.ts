import { createHash } from 'node:crypto'

/** legacy 队列把作业描述持久化在 task_attempts.checkpoint 里的形状。 */
export interface LegacyQueueCheckpoint {
  schemaVersion: number
  kind: string
  payload: Record<string, unknown>
}

export function queueFingerprint(
  kind: string,
  payload: Record<string, unknown>
): string {
  return createHash('sha256')
    .update(kind)
    .update('\0')
    .update(JSON.stringify(payload))
    .digest('hex')
}

export function parseCheckpoint(value: unknown): LegacyQueueCheckpoint {
  if (!value || typeof value !== 'object') {
    throw new Error('legacy queue checkpoint is invalid')
  }
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== 1 ||
    typeof record.kind !== 'string' ||
    !record.payload ||
    typeof record.payload !== 'object' ||
    Array.isArray(record.payload)
  ) {
    throw new Error('legacy queue checkpoint is invalid')
  }
  return {
    schemaVersion: 1,
    kind: record.kind,
    payload: record.payload as Record<string, unknown>,
  }
}
