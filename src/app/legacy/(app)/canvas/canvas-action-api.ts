import type { CanvasGraphNode } from '@/features/canvas'

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
): Promise<string> {
  const render = node.type === 'shot-codegen'
  if (!render && (!node.stage || !DIRECTOR_STAGES.has(node.stage))) {
    throw new Error('当前节点没有可执行阶段')
  }
  const response = await fetcher(
    render ? '/api/render' : '/api/director/stage',
    jsonRequest(
      render
        ? { projectId, nodeId: node.id }
        : { projectId, nodeId: node.id, stage: node.stage }
    )
  )
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('作业响应无效')
  }
  const result = body as Record<string, unknown>
  if (!response.ok) {
    throw new Error(typeof result.error === 'string' ? result.error : '作业入队失败')
  }
  if (typeof result.jobId !== 'string') throw new Error('作业响应缺少 jobId')
  return result.jobId
}

export interface PipelineControlResult {
  autopilot: boolean
  enqueuedNodeIds?: string[]
  failedNodeIds?: string[]
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
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('工作流响应无效')
  }
  const result = body as Record<string, unknown>
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
  }
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
