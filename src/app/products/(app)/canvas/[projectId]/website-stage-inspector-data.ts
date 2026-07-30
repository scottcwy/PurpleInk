export const WEBSITE_INSPECTOR_TABS = [
  { value: 'data', label: 'Data' },
  { value: 'source', label: 'Source' },
  { value: 'gates', label: 'Gates' },
  { value: 'execution', label: 'Execution' },
] as const

export type WebsiteInspectorTab =
  (typeof WEBSITE_INSPECTOR_TABS)[number]['value']

const PHASES = [
  'capture',
  'script',
  'narration',
  'compose',
  'render',
  'export',
] as const
const STATES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const
const ENGINE_PHASES = [
  'queued',
  'capturing',
  'scripting',
  'synthesizing',
  'timing',
  'composing',
  'rendering',
  'verifying',
  'muxing',
  'done',
  'failed',
] as const
const FAILURE_CODES = [
  'WEBSITE_ENGINE_TIMEOUT',
  'WEBSITE_ENGINE_FAILED',
  'WEBSITE_ENGINE_UNAVAILABLE',
  'WEBSITE_ENGINE_RESPONSE_INVALID',
  'WEBSITE_VIDEO_INVALID',
  'WEBSITE_PROJECT_INVALID',
  'WEBSITE_EXECUTION_FAILED',
] as const

export interface WebsiteExecutionProjection {
  phase?: (typeof PHASES)[number]
  state?: (typeof STATES)[number]
  enginePhase?: (typeof ENGINE_PHASES)[number]
  durationSec?: number
  durationSource?: 'request' | 'output'
  elapsedSec?: number
  updatedAt?: string
  verification?: {
    checkPassed?: boolean
    goldenVerified?: boolean
    goldenCheckCount?: number
    outcome?: 'passed' | 'degraded'
  }
  artifact?: {
    artifactId: string
    contentHash: string
    sizeBytes: number
  }
  failureCode?: (typeof FAILURE_CODES)[number]
}

export function parseWebsiteExecution(
  nodeData: Record<string, unknown>,
): WebsiteExecutionProjection | undefined {
  const raw = asRecord(nodeData.websiteExecution)
  if (!raw) return undefined

  const phase = readEnum(raw.phase, PHASES)
  const state = readEnum(raw.state, STATES)
  const enginePhase = readEnum(raw.enginePhase, ENGINE_PHASES)
  const durationSec = readNonnegativeNumber(raw.durationSec)
  const durationSource = readEnum(raw.durationSource, ['request', 'output'] as const)
  const elapsedSec = readNonnegativeNumber(raw.elapsedSec)
  const updatedAt = readIsoDate(raw.updatedAt)
  const verification = parseVerification(raw.verification)
  const artifact = parseArtifact(raw.artifact)
  const failureCode = readEnum(asRecord(raw.failure)?.code, FAILURE_CODES)

  const projection: WebsiteExecutionProjection = {
    ...(phase ? { phase } : {}),
    ...(state ? { state } : {}),
    ...(enginePhase ? { enginePhase } : {}),
    ...(durationSec !== undefined ? { durationSec } : {}),
    ...(durationSource ? { durationSource } : {}),
    ...(elapsedSec !== undefined ? { elapsedSec } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(verification ? { verification } : {}),
    ...(artifact ? { artifact } : {}),
    ...(failureCode ? { failureCode } : {}),
  }
  return Object.keys(projection).length > 0 ? projection : undefined
}

function parseVerification(
  value: unknown,
): WebsiteExecutionProjection['verification'] | undefined {
  const raw = asRecord(value)
  if (!raw) return undefined
  const checkPassed = readBoolean(raw.checkPassed)
  const goldenVerified = readBoolean(raw.goldenVerified)
  const goldenCheckCount = readNonnegativeInteger(raw.goldenCheckCount)
  const outcome = readEnum(raw.outcome, ['passed', 'degraded'] as const)
  const result: NonNullable<WebsiteExecutionProjection['verification']> = {
    ...(checkPassed !== undefined ? { checkPassed } : {}),
    ...(goldenVerified !== undefined ? { goldenVerified } : {}),
    ...(goldenCheckCount !== undefined ? { goldenCheckCount } : {}),
    ...(outcome ? { outcome } : {}),
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function parseArtifact(
  value: unknown,
): WebsiteExecutionProjection['artifact'] | undefined {
  const raw = asRecord(value)
  if (!raw) return undefined
  const artifactId = readBoundedString(raw.artifactId, 128)
  const contentHash =
    typeof raw.contentHash === 'string' && /^[a-f0-9]{64}$/u.test(raw.contentHash)
      ? raw.contentHash
      : undefined
  const sizeBytes = readNonnegativeInteger(raw.sizeBytes)
  return artifactId && contentHash && sizeBytes !== undefined
    ? { artifactId, contentHash, sizeBytes }
    : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function readEnum<const T extends readonly string[]>(
  value: unknown,
  values: T,
): T[number] | undefined {
  return typeof value === 'string' && values.includes(value) ? value : undefined
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function readNonnegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined
}

function readNonnegativeInteger(value: unknown): number | undefined {
  const parsed = readNonnegativeNumber(value)
  return parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined
}

function readBoundedString(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : undefined
}

function readIsoDate(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
    ? value
    : undefined
}
