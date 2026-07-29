import type { CanvasGraphNode } from '@/features/canvas'
import { throwIfUnauthenticated } from '@/features/auth/unauthenticated-error'

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

export interface PipelineControlResult {
  autopilot: boolean
  status?: 'started' | 'blocked' | 'complete'
  enqueuedNodeIds?: string[]
  repairRootNodeIds?: string[]
  failedNodeIds?: string[]
  blockedNodes?: Array<{ nodeId: string; code: string; message: string }>
}

export async function startPipeline(
  projectId: string,
  fetcher: typeof fetch = fetch
): Promise<PipelineControlResult> {
  return controlPipeline('POST', projectId, fetcher)
}

export async function stopPipeline(
  projectId: string,
  fetcher: typeof fetch = fetch
): Promise<PipelineControlResult> {
  return controlPipeline('DELETE', projectId, fetcher)
}

async function controlPipeline(
  method: 'POST' | 'DELETE',
  projectId: string,
  fetcher: typeof fetch
): Promise<PipelineControlResult> {
  const response = await fetcher('/api/director/pipeline', {
    ...jsonRequest({ projectId }),
    method,
  })
  throwIfUnauthenticated(response)
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('工作流响应无效')
  }
  const result = body as Record<string, unknown>
  throwIfQuotaExhausted(result)
  if (!response.ok) {
    throw new Error(
      typeof result.error === 'string' ? result.error : '工作流操作失败'
    )
  }
  if (typeof result.autopilot !== 'boolean') {
    throw new Error('工作流响应缺少 autopilot 状态')
  }
  return {
    autopilot: result.autopilot,
    ...(Array.isArray(result.enqueuedNodeIds)
      ? { enqueuedNodeIds: result.enqueuedNodeIds.filter(isString) }
      : {}),
    ...(Array.isArray(result.failedNodeIds)
      ? { failedNodeIds: result.failedNodeIds.filter(isString) }
      : {}),
    ...(isPipelineStatus(result.status) ? { status: result.status } : {}),
    ...(Array.isArray(result.repairRootNodeIds)
      ? { repairRootNodeIds: result.repairRootNodeIds.filter(isString) }
      : {}),
    ...(Array.isArray(result.blockedNodes)
      ? {
          blockedNodes: result.blockedNodes
            .filter(isRecord)
            .flatMap((item) =>
              typeof item.nodeId === 'string' &&
              typeof item.code === 'string' &&
              typeof item.message === 'string'
                ? [{ nodeId: item.nodeId, code: item.code, message: item.message }]
                : []
            ),
        }
      : {}),
  }
}

export class BillingQuotaExhaustedError extends Error {
  readonly code = 'quota_exhausted'

  constructor(
    readonly resetAt: string,
    readonly billingUrl: '/products/billing',
  ) {
    super('本周期 AI 额度已用完')
    this.name = 'BillingQuotaExhaustedError'
  }
}

function throwIfQuotaExhausted(result: Record<string, unknown>): void {
  if (
    result.code === 'quota_exhausted'
    && typeof result.resetAt === 'string'
    && result.billingUrl === '/products/billing'
  ) {
    throw new BillingQuotaExhaustedError(result.resetAt, result.billingUrl)
  }
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

function isPipelineStatus(
  value: unknown
): value is NonNullable<PipelineControlResult['status']> {
  return ['started', 'blocked', 'complete'].includes(String(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function jsonRequest(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}
