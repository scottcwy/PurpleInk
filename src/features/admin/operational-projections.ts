import type { WorkflowExecutionNotice, WorkflowFaultCode } from '@/features/canvas'

export type AdminFailureCategory =
  | 'none'
  | 'capacity'
  | 'timeout'
  | 'validation'
  | 'authentication'
  | 'transport'
  | 'cancelled'
  | 'internal'

const FAILURE_CATEGORY_BY_CODE = {
  PROVIDER_RATE_LIMITED: 'capacity',
  PROVIDER_TIMEOUT: 'timeout',
  PROVIDER_UNAVAILABLE: 'transport',
  PROVIDER_AUTH_FAILED: 'authentication',
  PROVIDER_BALANCE_EXHAUSTED: 'capacity',
  PROVIDER_PERMISSION_DENIED: 'authentication',
  PROVIDER_REQUEST_REJECTED: 'validation',
  PROVIDER_SAFETY_REJECTED: 'validation',
  PLATFORM_PREFLIGHT_FAILED: 'internal',
  PLATFORM_QUEUE_FAILED: 'internal',
  PLATFORM_STORAGE_FAILED: 'internal',
  PLATFORM_RENDER_FAILED: 'internal',
  PLATFORM_INTERNAL_ERROR: 'internal',
  UPSTREAM_ARTIFACT_MISSING: 'validation',
  FINAL_ARTIFACT_NOT_READY: 'validation',
  UPSTREAM_ARTIFACT_INVALID: 'validation',
  STAGE_INPUT_INVALID: 'validation',
  INTERNAL_PREFLIGHT_FAILED: 'internal',
  AUDIO_SOURCE_INTEGRITY_INVALID: 'validation',
  ROUTE_CONTRACT_INVALID: 'validation',
  ROUTE_NOT_AUTHORIZED: 'authentication',
  MEDIA_NOT_READY: 'validation',
  TASK_INTERRUPTED: 'cancelled',
  RETRY_BUDGET_EXHAUSTED: 'capacity',
  DEGRADED_EXPORT_CONFIRMATION_REQUIRED: 'validation',
  QUOTA_EXHAUSTED: 'capacity',
  CONFIGURATION_BLOCKED: 'validation',
  PROVIDER_FAILED: 'internal',
  FABRICATE_FAILED: 'internal',
  RENDER_FAILED: 'internal',
  MEDIA_FAILED: 'internal',
  QUEUE_FAILED: 'internal',
  STAGE_FAILED: 'internal',
  PROVIDER_POOL_WAIT: 'capacity',
  PLAN_CONCURRENCY_WAIT: 'capacity',
} as const satisfies Record<
  WorkflowFaultCode | WorkflowExecutionNotice['code'],
  AdminFailureCategory
>

export interface AdminJobRow {
  runId: string
  runStatus: string
  workflowVersion: string
  runCreatedAt: string
  attemptId: string | null
  taskId: string | null
  entityType: string | null
  attemptNo: number | null
  attemptStatus: string | null
  attemptCreatedAt: string | null
  attemptCompletedAt: string | null
  failureCategory: AdminFailureCategory
}

interface JobProjectionInput {
  runId: string
  runStatus: string
  workflowVersion: string
  runCreatedAt: Date
  attemptId: string | null
  taskId: string | null
  entityType: string | null
  attemptNo: number | null
  attemptStatus: string | null
  attemptCreatedAt: Date | null
  attemptCompletedAt: Date | null
  failure: unknown
}

export interface AdminAiAuditRow {
  logicalModelId: string
  outboundModelId: string
  deploymentId: string
  channelId: string
  funding: string
  failureDomainId: string
  status: string
  invocationCount: number
  officialCost: {
    totalCnyMicros: string | null
    knownCnyMicros: string
    ledgerCount: number
    measurementQualities: string[]
  }
  entitlement: {
    totalDebitCnyMicros: string | null
    knownDebitCnyMicros: string
    ledgerCount: number
  }
  lastInvokedAt: string
}

interface AiAuditProjectionInput extends Record<string, unknown> {
  logicalModelId: string | null
  outboundModelId: string | null
  deploymentId: string | null
  channelId: string | null
  funding: string
  failureDomainId: string | null
  status: string
  invocationCount: number
  officialCostCnyMicros: string | number | bigint | null
  officialCostKnownCnyMicros: string | number | bigint
  officialCostLedgerCount: number
  officialCostMeasurementQualities: string | null
  entitlementDebitCnyMicros: string | number | bigint | null
  entitlementKnownDebitCnyMicros: string | number | bigint
  entitlementLedgerCount: number
  lastInvokedAt: Date | string
}

export function classifyAttemptFailure(failure: unknown): AdminFailureCategory {
  if (!failure || typeof failure !== 'object') return 'none'
  const payload = 'payload' in failure ? failure.payload : failure
  if (!payload || typeof payload !== 'object') return 'internal'
  const record = payload as Record<string, unknown>
  if (typeof record.code !== 'string') return 'internal'
  return FAILURE_CATEGORY_BY_CODE[record.code as keyof typeof FAILURE_CATEGORY_BY_CODE]
    ?? 'internal'
}

export function normalizeJobRow(input: JobProjectionInput): AdminJobRow {
  return {
    runId: input.runId,
    runStatus: input.runStatus,
    workflowVersion: input.workflowVersion,
    runCreatedAt: input.runCreatedAt.toISOString(),
    attemptId: input.attemptId,
    taskId: input.taskId,
    entityType: input.entityType,
    attemptNo: input.attemptNo,
    attemptStatus: input.attemptStatus,
    attemptCreatedAt: input.attemptCreatedAt?.toISOString() ?? null,
    attemptCompletedAt: input.attemptCompletedAt?.toISOString() ?? null,
    failureCategory: classifyAttemptFailure(input.failure),
  }
}

export function normalizeAiAuditRow(input: AiAuditProjectionInput): AdminAiAuditRow {
  return {
    logicalModelId: input.logicalModelId ?? 'unknown',
    outboundModelId: input.outboundModelId ?? 'unknown',
    deploymentId: input.deploymentId ?? 'unknown',
    channelId: input.channelId ?? 'unknown',
    funding: input.funding,
    failureDomainId: input.failureDomainId ?? 'unknown',
    status: input.status,
    invocationCount: input.invocationCount,
    officialCost: {
      totalCnyMicros: nullableMicros(input.officialCostCnyMicros),
      knownCnyMicros: String(input.officialCostKnownCnyMicros),
      ledgerCount: input.officialCostLedgerCount,
      measurementQualities: input.officialCostMeasurementQualities?.split(',') ?? [],
    },
    entitlement: {
      totalDebitCnyMicros: nullableMicros(input.entitlementDebitCnyMicros),
      knownDebitCnyMicros: String(input.entitlementKnownDebitCnyMicros),
      ledgerCount: input.entitlementLedgerCount,
    },
    lastInvokedAt: normalizeTimestamp(input.lastInvokedAt),
  }
}

function nullableMicros(value: string | number | bigint | null): string | null {
  return value === null ? null : String(value)
}

export function normalizeTimestamp(value: unknown): string {
  if (!(value instanceof Date) && typeof value !== 'string') {
    throw new Error('invalid database timestamp')
  }
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('invalid database timestamp')
  return date.toISOString()
}
