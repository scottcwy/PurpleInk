import type { CanvasGraphNode } from '@/features/canvas'
import { throwIfUnauthenticated } from '@/features/auth/unauthenticated-error'
import { throwIfQuotaExhausted } from '@/features/projects/execution-control-client'
export {
  BillingQuotaExhaustedError,
  startPipeline,
  stopPipeline,
  type PipelineControlResult,
} from '@/features/projects/execution-control-client'

const DIRECTOR_STAGES = new Set([
  'INGEST',
  'DIRECT',
  'SHOT_SPEC',
  'FABRICATE',
  'ASSEMBLE',
  'FINALIZE',
])

export async function triggerNodeAction(
  projectId: string,
  node: CanvasGraphNode,
  fetcher: typeof fetch = fetch
): Promise<NodeActionResult> {
  if (node.status === 'pending' || node.status === 'running') {
    throw new Error('当前节点已在排队或执行中')
  }
  const render = node.type === 'shot-codegen'
  if (!render && (!node.stage || !DIRECTOR_STAGES.has(node.stage))) {
    throw new Error('当前节点没有可执行阶段')
  }
  const response = await fetcher(
    render ? '/api/render' : '/api/director/stage',
    jsonRequest({ projectId, nodeId: node.id, intent: resolveIntent(node) })
  )
  return parseNodeActionResponse(response)
}

/**
 * 手动跳过可跳过节点（intent=skip，见 routing.md 跳过合同）；原因必填，由服务端校验长度。
 */
export async function triggerNodeSkip(
  projectId: string,
  node: CanvasGraphNode,
  reason: string,
  fetcher: typeof fetch = fetch
): Promise<NodeActionResult> {
  const response = await fetcher(
    '/api/director/stage',
    jsonRequest({ projectId, nodeId: node.id, intent: 'skip', skipReason: reason })
  )
  return parseNodeActionResponse(response)
}

async function parseNodeActionResponse(response: Response): Promise<NodeActionResult> {
  // 401 统一映射成可识别错误类型，由 useRequireLogin 接管（PLAN-002 §4.4）。
  throwIfUnauthenticated(response)
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('作业响应无效')
  }
  const result = body as Record<string, unknown>
  throwIfQuotaExhausted(result)
  if (!response.ok) {
    throw new Error(typeof result.error === 'string' ? result.error : '作业入队失败')
  }
  if (
    typeof result.jobId !== 'string' ||
    typeof result.requestedNodeId !== 'string' ||
    typeof result.queuedNodeId !== 'string' ||
    typeof result.message !== 'string' ||
    !isNodeAction(result.action)
  ) {
    throw new Error('作业响应缺少恢复结果')
  }
  return {
    ok: true,
    action: result.action,
    requestedNodeId: result.requestedNodeId,
    queuedNodeId: result.queuedNodeId,
    jobId: result.jobId,
    message: result.message,
  }
}

export async function triggerCancelProviderWait(
  projectId: string,
  node: CanvasGraphNode,
  fetcher: typeof fetch = fetch
): Promise<NodeActionResult> {
  const response = await fetcher(
    '/api/director/stage',
    jsonRequest({ projectId, nodeId: node.id, intent: 'cancel-wait' })
  )
  return parseNodeActionResponse(response)
}

export interface NodeActionResult {
  ok: true
  action:
    | 'execute'
    | 'repair-upstream'
    | 'regenerate'
    | 'rerender'
    | 'skip'
    | 'cancel-wait'
  requestedNodeId: string
  queuedNodeId: string
  jobId: string
  message: string
}

function resolveIntent(
  node: CanvasGraphNode
): 'execute' | 'repair' | 'regenerate' | 'rerender' {
  if (node.status === 'failed' || node.status === 'stale') return 'repair'
  if (node.status === 'success') {
    return node.type === 'shot-codegen' ? 'rerender' : 'regenerate'
  }
  // skipped 与 idle 同路：重新执行以恢复真实产出。
  return 'execute'
}

function isNodeAction(value: unknown): value is NodeActionResult['action'] {
  return [
    'execute',
    'repair-upstream',
    'regenerate',
    'rerender',
    'skip',
    'cancel-wait',
  ].includes(
    String(value)
  )
}


function jsonRequest(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}
