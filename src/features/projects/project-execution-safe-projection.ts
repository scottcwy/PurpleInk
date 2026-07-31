import type { WebsiteEnginePhase } from '@/features/website/engine-client'
import type { WebsiteVerificationProjection } from '@/features/website/website-stage-contract'
import type {
  ProjectExecutionFailureCode,
  ProjectExecutionFailureSnapshot,
  WebsiteDeliverySnapshot,
  WebsiteStageSnapshot,
  WebsiteStageState,
} from './project-execution-contract'

export function websiteStageState(
  value: unknown,
  persisted: string,
): WebsiteStageState {
  if (
    value === 'idle'
    || value === 'queued'
    || value === 'running'
    || value === 'succeeded'
    || value === 'blocked'
    || value === 'failed'
    || value === 'cancelled'
  ) {
    return value
  }
  if (persisted === 'queued') return 'queued'
  if (persisted === 'running') return 'running'
  if (persisted === 'succeeded') return 'succeeded'
  if (persisted === 'failed') return 'failed'
  if (persisted === 'cancelled') return 'cancelled'
  return 'idle'
}

export function safeFailureCode(
  value: unknown,
): ProjectExecutionFailureCode | undefined {
  const candidate = record(value)
  const code = typeof candidate.failureCode === 'string'
    ? candidate.failureCode
    : typeof candidate.code === 'string'
      ? candidate.code
      : undefined
  return code && [
    'WEBSITE_ENGINE_TIMEOUT',
    'WEBSITE_ENGINE_FAILED',
    'WEBSITE_ENGINE_UNAVAILABLE',
    'WEBSITE_ENGINE_RESPONSE_INVALID',
    'WEBSITE_VIDEO_INVALID',
    'WEBSITE_PROJECT_INVALID',
    'WEBSITE_EXECUTION_FAILED',
    'WEBSITE_VERIFICATION_FAILED',
    'WEBSITE_STATE_INCONSISTENT',
  ].includes(code)
    ? code as ProjectExecutionFailureCode
    : undefined
}

export function safeFailureProjection(
  value: unknown,
  fallbackCode?: ProjectExecutionFailureCode,
): ProjectExecutionFailureSnapshot | null {
  const candidate = record(value)
  const rawCode = typeof candidate.failureCode === 'string'
    ? candidate.failureCode
    : typeof candidate.code === 'string'
      ? candidate.code
      : fallbackCode
  if (!rawCode || !/^[A-Z][A-Z0-9_]{2,63}$/u.test(rawCode)) return null
  const origin = typeof candidate.origin === 'string'
    && ['user', 'platform', 'provider', 'content', 'unknown'].includes(candidate.origin)
    ? candidate.origin as NonNullable<ProjectExecutionFailureSnapshot['origin']>
    : undefined
  const recovery = typeof candidate.recovery === 'string'
    && [
      'auto_wait',
      'manual_retry',
      'fix_settings',
      'upgrade_plan',
      'edit_input',
      'switch_provider',
      'confirm_degraded_export',
      'contact_support',
    ].includes(candidate.recovery)
    ? candidate.recovery as NonNullable<ProjectExecutionFailureSnapshot['recovery']>
    : undefined
  const referenceId = typeof candidate.referenceId === 'string'
    && candidate.referenceId.length <= 128
    ? candidate.referenceId
    : undefined
  return {
    code: rawCode,
    ...(origin ? { origin } : {}),
    ...(typeof candidate.retryable === 'boolean'
      ? { retryable: candidate.retryable }
      : {}),
    ...(recovery ? { recovery } : {}),
    ...(referenceId ? { referenceId } : {}),
  }
}

export function safeVerification(
  value: unknown,
): WebsiteVerificationProjection | undefined {
  const candidate = record(value)
  if (
    typeof candidate.checkPassed !== 'boolean'
    || typeof candidate.goldenVerified !== 'boolean'
    || typeof candidate.goldenCheckCount !== 'number'
    || !Number.isInteger(candidate.goldenCheckCount)
  ) {
    return undefined
  }
  return {
    checkPassed: candidate.checkPassed,
    goldenVerified: candidate.goldenVerified,
    goldenCheckCount: candidate.goldenCheckCount,
    outcome: candidate.checkPassed && candidate.goldenVerified
      ? 'passed'
      : 'degraded',
  }
}

export function safeArtifact(
  value: unknown,
): WebsiteStageSnapshot['artifact'] | undefined {
  const candidate = record(value)
  if (
    typeof candidate.artifactId !== 'string'
    || typeof candidate.contentHash !== 'string'
    || !/^[0-9a-f]{64}$/u.test(candidate.contentHash)
    || typeof candidate.sizeBytes !== 'number'
    || candidate.sizeBytes < 0
  ) {
    return undefined
  }
  return {
    artifactId: candidate.artifactId,
    contentHash: candidate.contentHash,
    sizeBytes: candidate.sizeBytes,
  }
}

export function safeEnginePhase(value: unknown): WebsiteEnginePhase | undefined {
  return typeof value === 'string' && [
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
    'cancelled',
  ].includes(value)
    ? value as WebsiteEnginePhase
    : undefined
}

export function optionalNumberOrNull(
  value: unknown,
  key: 'durationSec' | 'elapsedSec',
): Partial<Pick<WebsiteStageSnapshot, 'durationSec' | 'elapsedSec'>> {
  return value === null || (typeof value === 'number' && value >= 0)
    ? { [key]: value }
    : {}
}

export function optionalDurationSource(
  value: unknown,
): Pick<WebsiteStageSnapshot, 'durationSource'> | Record<string, never> {
  return value === null || value === 'request' || value === 'output'
    ? { durationSource: value }
    : {}
}

export function isLifecycle(
  value: string,
): value is WebsiteDeliverySnapshot['lifecycle'] {
  return ['draft', 'approved', 'released', 'rejected'].includes(value)
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
