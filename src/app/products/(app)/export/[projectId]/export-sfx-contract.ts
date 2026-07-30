import type { ExportSettings } from '@/features/canvas/export-settings'

export interface ExportArtifactSoundEffects {
  mode: 'off' | 'procedural'
  status:
    | 'applied'
    | 'omitted-off'
    | 'omitted-no-cues'
    | 'omitted-unsupported'
    | 'omitted-error'
  generatorVersion: 'procedural-sfx/1.0.0'
  cueCount: number
  timingHash: string | null
  cuePlanHash: string | null
  waveformHashes: string[]
  failureCode?: 'PROCEDURAL_SFX_MIX_FAILED'
}

export function isSoundEffectsMode(
  value: unknown
): value is ExportSettings['soundEffects'] {
  return value === 'off' || value === 'procedural'
}

export function parseExportArtifactSoundEffects(
  value: unknown
): ExportArtifactSoundEffects | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (
    !isSoundEffectsMode(raw.mode)
    || !isStatus(raw.status)
    || raw.generatorVersion !== 'procedural-sfx/1.0.0'
    || !isNonNegativeInteger(raw.cueCount)
    || !isHashOrNull(raw.timingHash)
    || !isHashOrNull(raw.cuePlanHash)
    || !Array.isArray(raw.waveformHashes)
    || !raw.waveformHashes.every(isHash)
    || (
      raw.failureCode !== undefined
      && raw.failureCode !== 'PROCEDURAL_SFX_MIX_FAILED'
    )
  ) {
    return null
  }
  return {
    mode: raw.mode,
    status: raw.status,
    generatorVersion: raw.generatorVersion,
    cueCount: raw.cueCount,
    timingHash: raw.timingHash,
    cuePlanHash: raw.cuePlanHash,
    waveformHashes: raw.waveformHashes,
    ...(raw.failureCode ? { failureCode: raw.failureCode } : {}),
  }
}

function isStatus(value: unknown): value is ExportArtifactSoundEffects['status'] {
  return typeof value === 'string' && [
    'applied',
    'omitted-off',
    'omitted-no-cues',
    'omitted-unsupported',
    'omitted-error',
  ].includes(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)
}

function isHashOrNull(value: unknown): value is string | null {
  return value === null || isHash(value)
}
