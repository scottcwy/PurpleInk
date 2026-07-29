import type { WorkflowExecutionNotice } from './workflow-fault'

export interface DirectorNodeError {
  stage: string
  message: string
  code?: string
  schemaVersion?: number
  origin?: string
  title?: string
  recovery?: string
  retryable?: boolean
  sourceNodeId?: string
  provider?: NodeErrorProvider
  referenceId?: string
  occurredAt?: string
}

export interface RenderNodeError {
  message: string
  code?: string
  schemaVersion?: number
  origin?: string
  title?: string
  recovery?: string
  retryable?: boolean
  sourceNodeId?: string
  provider?: NodeErrorProvider
  referenceId?: string
  occurredAt?: string
}

export interface NodeErrorProvider {
  id: string
  label: string
  httpStatus?: number
  retryAt?: string
}

export function parseDirectorError(
  data: Record<string, unknown>
): DirectorNodeError | undefined {
  const raw = data.directorError
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  if (typeof record.stage !== 'string' || typeof record.message !== 'string') {
    return undefined
  }
  return {
    stage: record.stage,
    message: record.message,
    ...optionalErrorFields(record),
  }
}

export function parseRenderError(
  data: Record<string, unknown>
): RenderNodeError | undefined {
  const raw = data.renderError
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  if (typeof record.message !== 'string') return undefined
  return { message: record.message, ...optionalErrorFields(record) }
}

export function parseExecutionNotice(value: unknown): WorkflowExecutionNotice | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.code !== 'PROVIDER_RATE_LIMITED'
    || typeof record.message !== 'string'
    || typeof record.resumeAt !== 'string'
    || typeof record.providerLabel !== 'string'
  ) return undefined
  return {
    code: 'PROVIDER_RATE_LIMITED',
    message: record.message,
    resumeAt: record.resumeAt,
    providerLabel: record.providerLabel,
  }
}

function optionalErrorFields(record: Record<string, unknown>) {
  const provider = parseErrorProvider(record.provider)
  return {
    ...(typeof record.code === 'string' ? { code: record.code } : {}),
    ...(typeof record.schemaVersion === 'number'
      ? { schemaVersion: record.schemaVersion }
      : {}),
    ...(typeof record.origin === 'string' ? { origin: record.origin } : {}),
    ...(typeof record.title === 'string' ? { title: record.title } : {}),
    ...(typeof record.recovery === 'string' ? { recovery: record.recovery } : {}),
    ...(typeof record.retryable === 'boolean'
      ? { retryable: record.retryable }
      : {}),
    ...(typeof record.sourceNodeId === 'string'
      ? { sourceNodeId: record.sourceNodeId }
      : {}),
    ...(provider ? { provider } : {}),
    ...(typeof record.referenceId === 'string'
      ? { referenceId: record.referenceId }
      : {}),
    ...(typeof record.occurredAt === 'string'
      ? { occurredAt: record.occurredAt }
      : {}),
  }
}

function parseErrorProvider(value: unknown): NodeErrorProvider | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.label !== 'string') return undefined
  return {
    id: record.id,
    label: record.label,
    ...(typeof record.httpStatus === 'number' ? { httpStatus: record.httpStatus } : {}),
    ...(typeof record.retryAt === 'string' ? { retryAt: record.retryAt } : {}),
  }
}
