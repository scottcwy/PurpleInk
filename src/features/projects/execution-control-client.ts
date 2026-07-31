import { throwIfUnauthenticated } from '@/features/auth/unauthenticated-error'
import type { ProjectExecutionSnapshot } from './project-execution-contract'
import { parseProjectExecutionSnapshot } from './execution-client'

export interface PipelineControlResult {
  autopilot?: boolean
  execution: ProjectExecutionSnapshot
  status?:
    | 'started'
    | 'reused'
    | 'blocked'
    | 'complete'
    | 'stopping'
    | 'stopped'
  enqueuedNodeIds?: string[]
  repairRootNodeIds?: string[]
  failedNodeIds?: string[]
  blockedNodes?: Array<{ nodeId: string; code: string; message: string }>
  cancelledAttempts?: number
  cancelledRuns?: number
  cancelledTickets?: number
  cancelledLeases?: number
  remainingRunning?: number
}

export async function startPipeline(
  projectId: string,
  fetcher: typeof fetch = fetch,
): Promise<PipelineControlResult> {
  return controlPipeline('POST', projectId, fetcher)
}

export async function stopPipeline(
  projectId: string,
  fetcher: typeof fetch = fetch,
): Promise<PipelineControlResult> {
  return controlPipeline('DELETE', projectId, fetcher)
}

async function controlPipeline(
  method: 'POST' | 'DELETE',
  projectId: string,
  fetcher: typeof fetch,
): Promise<PipelineControlResult> {
  const response = await fetcher(
    `/api/projects/${encodeURIComponent(projectId)}/start`,
    { method },
  )
  throwIfUnauthenticated(response)
  const body: unknown = await response.json()
  if (!isRecord(body)) throw new Error('工作流响应无效')
  throwIfQuotaExhausted(body)
  if (!response.ok) {
    throw new Error(
      typeof body.error === 'string' ? body.error : '工作流操作失败',
    )
  }
  return {
    execution: parseProjectExecutionSnapshot(body.execution),
    ...(typeof body.autopilot === 'boolean'
      ? { autopilot: body.autopilot }
      : {}),
    ...stringArray('enqueuedNodeIds', body),
    ...stringArray('failedNodeIds', body),
    ...(isPipelineStatus(body.status) ? { status: body.status } : {}),
    ...optionalCount('cancelledAttempts', body),
    ...optionalCount('cancelledRuns', body),
    ...optionalCount('cancelledTickets', body),
    ...optionalCount('cancelledLeases', body),
    ...optionalCount('remainingRunning', body),
    ...stringArray('repairRootNodeIds', body),
    ...(Array.isArray(body.blockedNodes)
      ? {
          blockedNodes: body.blockedNodes
            .filter(isRecord)
            .flatMap((item) =>
              typeof item.nodeId === 'string'
              && typeof item.code === 'string'
              && typeof item.message === 'string'
                ? [{
                    nodeId: item.nodeId,
                    code: item.code,
                    message: item.message,
                  }]
                : []),
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

export function throwIfQuotaExhausted(
  result: Record<string, unknown>,
): void {
  if (
    result.code === 'quota_exhausted'
    && typeof result.resetAt === 'string'
    && result.billingUrl === '/products/billing'
  ) {
    throw new BillingQuotaExhaustedError(result.resetAt, result.billingUrl)
  }
}

function isPipelineStatus(
  value: unknown,
): value is NonNullable<PipelineControlResult['status']> {
  return [
    'started',
    'reused',
    'blocked',
    'complete',
    'stopping',
    'stopped',
  ].includes(String(value))
}

function optionalCount(
  key:
    | 'cancelledAttempts'
    | 'cancelledRuns'
    | 'cancelledTickets'
    | 'cancelledLeases'
    | 'remainingRunning',
  value: Record<string, unknown>,
): Partial<PipelineControlResult> {
  const count = value[key]
  return typeof count === 'number' && Number.isInteger(count) && count >= 0
    ? { [key]: count }
    : {}
}

function stringArray(
  key: 'enqueuedNodeIds' | 'failedNodeIds' | 'repairRootNodeIds',
  value: Record<string, unknown>,
): Partial<PipelineControlResult> {
  const items = value[key]
  return Array.isArray(items)
    ? { [key]: items.filter((item): item is string => typeof item === 'string') }
    : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
