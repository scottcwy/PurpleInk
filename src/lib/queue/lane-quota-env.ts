import { isPositiveInteger } from './in-process-queue'
import type { LaneQuotas } from './types'

const LANE_QUOTA_ENV_KEYS: Record<string, string> = {
  'director-stage': 'CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY',
  'render-shot': 'CVC_QUEUE_RENDER_SHOT_CONCURRENCY',
}

export function resolveLaneQuotas(
  env: Record<string, string | undefined> = process.env
): LaneQuotas {
  const overrides: LaneQuotas = {}
  for (const [kind, envKey] of Object.entries(LANE_QUOTA_ENV_KEYS)) {
    const raw = env[envKey]
    if (raw === undefined || raw.trim() === '') continue
    const parsed = Number(raw)
    if (!isPositiveInteger(parsed)) {
      throw new Error(
        `invalid ${envKey}: "${raw}" (must be a positive integer)`
      )
    }
    overrides[kind] = parsed
  }
  return overrides
}
