export type AdminFailureCategory =
  | 'none'
  | 'capacity'
  | 'timeout'
  | 'validation'
  | 'authentication'
  | 'transport'
  | 'cancelled'
  | 'internal'

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
  const discriminator = [record.category, record.kind, record.code, record.type]
    .find((value): value is string => typeof value === 'string')
    ?.toLowerCase() ?? ''

  if (/rate|capacity|quota|concurr|busy|429/.test(discriminator)) return 'capacity'
  if (/timeout|deadline|lease/.test(discriminator)) return 'timeout'
  if (/valid|schema|input|contract/.test(discriminator)) return 'validation'
  if (/auth|credential|permission|forbidden/.test(discriminator)) return 'authentication'
  if (/network|transport|connection|socket/.test(discriminator)) return 'transport'
  if (/cancel|abort|stop/.test(discriminator)) return 'cancelled'
  return 'internal'
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
