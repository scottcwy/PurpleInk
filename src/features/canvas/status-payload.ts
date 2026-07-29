import type { WorkflowBlock, WorkflowExecutionNotice } from './workflow-fault'
import type { SkipMeta } from './status'
import type { NodeStatus } from './types'

interface VersionedPayload {
  schemaVersion: number
  [key: string]: unknown
}

const STAGE_ERROR_PAYLOAD_KEYS = [
  'directorError',
  'renderError',
  'executionNotice',
  'workflowBlock',
] as const

const SKIP_META_PAYLOAD_KEY = 'skipMeta'
const EXECUTION_NOTICE_PAYLOAD_KEY = 'executionNotice'
const WORKFLOW_BLOCK_PAYLOAD_KEY = 'workflowBlock'

export function resolveTransitionData(
  data: VersionedPayload,
  current: NodeStatus,
  next: NodeStatus,
  skipMeta: SkipMeta | undefined,
  executionNotice: WorkflowExecutionNotice | null | undefined,
  workflowBlock: WorkflowBlock | undefined,
): VersionedPayload | null {
  if (next === 'blocked') {
    if (!workflowBlock) {
      throw new Error('转入 blocked 必须提供 workflowBlock（确认门禁）')
    }
    const cleared = withoutStageErrors(data) ?? data
    return patchPayload(cleared, { [WORKFLOW_BLOCK_PAYLOAD_KEY]: workflowBlock })
  }
  if (executionNotice) {
    return patchPayload(data, { [EXECUTION_NOTICE_PAYLOAD_KEY]: executionNotice })
  }
  if (executionNotice === null || next === 'running') {
    return withoutPayloadKeys(data, [EXECUTION_NOTICE_PAYLOAD_KEY])
  }
  if (next === 'success') return withoutStageErrors(data)
  if (next === 'skipped') {
    if (!skipMeta) throw new Error('转入 skipped 必须提供 skipMeta（跳过原因）')
    const cleared = withoutStageErrors(data) ?? data
    return patchPayload(cleared, { [SKIP_META_PAYLOAD_KEY]: skipMeta })
  }
  if (current === 'skipped') {
    return withoutPayloadKeys(data, [SKIP_META_PAYLOAD_KEY])
  }
  if (current === 'blocked') {
    return withoutPayloadKeys(data, [WORKFLOW_BLOCK_PAYLOAD_KEY])
  }
  return null
}

function withoutStageErrors(value: VersionedPayload): VersionedPayload | null {
  return withoutPayloadKeys(value, STAGE_ERROR_PAYLOAD_KEYS)
}

function withoutPayloadKeys(
  value: VersionedPayload,
  keys: readonly string[]
): VersionedPayload | null {
  const payload = value.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const entries = payload as Record<string, unknown>
  const present = keys.filter((key) => Object.hasOwn(entries, key))
  if (present.length === 0) return null
  const nextPayload = { ...entries }
  for (const key of present) delete nextPayload[key]
  return { ...value, payload: nextPayload }
}

export function patchPayload(
  value: VersionedPayload,
  patch: Record<string, unknown>
): VersionedPayload {
  const current =
    value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload)
      ? value.payload as Record<string, unknown>
      : {}
  return { ...value, payload: { ...current, ...patch } }
}

export function toPersistedStatus(status: NodeStatus): string {
  if (status === 'pending') return 'queued'
  if (status === 'success') return 'succeeded'
  return status
}

export function fromPersistedStatus(status: string): NodeStatus {
  if (status === 'queued') return 'pending'
  if (status === 'succeeded') return 'success'
  if (
    status === 'idle' ||
    status === 'running' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'stale' ||
    status === 'skipped' ||
    status === 'blocked'
  ) {
    return status
  }
  throw new Error(`未知节点状态：${status}`)
}
